import path from "node:path";
import type { Database } from "bun:sqlite";
import { AgentError } from "./agent-error.js";
import type { Agent } from "./agent-interface.js";
import { type AppConfig, resolveProjectPath } from "../config.js";
import { HookDispatcher } from "../../extensions/hooks.js";
import type { ExtensionRegistry } from "../../extensions/loader.js";
import type { MercuryExtensionContext } from "../../extensions/types.js";
import { logger } from "../logger.js";
import { ensurePiResourceDir } from "./workspace.js";
import { createTracer, type Tracer } from "../otel.js";

import type {
  AgentOutput,
  IngressMessage,
  MessageAttachment,
  MessageSender,
} from "../types.js";

import type { Services } from "../api-types.js";
import { AgentQueue } from "./queue.js";
import type { PolicyResult } from "../../services/policy/interface.js";

export type InputSource = "cli" | "scheduler" | "chat-sdk";

export type ShutdownHook = () => Promise<void> | void;

export interface RuntimeDeps {
  config: AppConfig;
  database: Database;
  services: Services;
  agent: Agent;
  queue?: AgentQueue;
}

export class MercuryCoreRuntime {
  readonly config: AppConfig;
  readonly database: Database;
  readonly services: Services;
  readonly queue: AgentQueue;
  readonly agent: Agent;
  hooks: HookDispatcher | null = null;
  private extensionCtx: MercuryExtensionContext | null = null;
  extensionRegistry: ExtensionRegistry | null = null;
  private readonly shutdownHooks: ShutdownHook[] = [];
  private shuttingDown = false;
  private signalHandlersInstalled = false;
  readonly workspace: string;
  readonly tracer: Tracer;

  constructor(deps: RuntimeDeps) {
    this.config = deps.config;
    this.database = deps.database;
    this.services = deps.services;
    this.agent = deps.agent;
    this.queue = deps.queue ?? new AgentQueue();

    this.workspace = resolveProjectPath(deps.config.workspaceDir);
    ensurePiResourceDir(this.workspace);

    this.tracer = createTracer({
      endpoint: this.config.otelEndpoint ?? "",
      serviceName: this.config.otelService,
    });
  }


  initExtensions(registry: ExtensionRegistry): void {
    this.hooks = new HookDispatcher(registry, logger);
    this.extensionRegistry = registry;
    this.extensionCtx = {
      db: this.database,
      config: this.config,
      log: logger,
    };
  }

  startScheduler(sender?: MessageSender): void {
    this.services.tasks.startScheduler(async (task) => {
      const traceId = this.tracer.newTraceId();
      const span = this.tracer.startSpan("mercury.scheduled_task", traceId);
      span.attr("task.id", String(task.id));
      const result = await this.executePrompt({
        prompt: task.prompt,
        source: "scheduler",
        callerId: task.createdBy,
        isDM: false,
        conversationId: task.conversationId,
        traceId,
        parentSpanId: span.id,
      });
      span.end();
      if (!task.silent && sender) {
        await sender.send(result.text, task.conversationId, result.files);
      }
    });
  }

  stopScheduler(): void {
    this.services.tasks.stopScheduler();
  }

  async handleMessage(
    message: IngressMessage,
    source: Exclude<InputSource, "scheduler">,
  ): Promise<PolicyResult & { result?: AgentOutput }> {
    const traceId = this.tracer.newTraceId();
    const span = this.tracer.startSpan("mercury.message", traceId);
    span.attr("message.source", source);
    span.attr("message.platform", message.platform);
    span.attr("message.caller_id", message.callerId);
    span.attr("message.is_dm", message.isDM);

    try {
      const outcome = await this.routeMessage(message, source, traceId, span.id);
      span.attr("message.action", outcome.action);
      span.end(outcome.action !== "deny");
      return outcome;
    } catch (error) {
      span.end(false);
      throw error;
    }
  }

  private async routeMessage(
    message: IngressMessage,
    source: Exclude<InputSource, "scheduler">,
    traceId: string,
    parentSpanId: string,
  ): Promise<PolicyResult & { result?: AgentOutput }> {
    if (source === "cli") {
      const prompt = message.text.trim();
      if (!prompt) return { action: "ignore" };
      if (this.services.mutes.isMuted(message.callerId)) return { action: "ignore" };

      const role = this.services.roles.resolveRole(message.callerId);
      try {
        const result = await this.executePrompt({
          prompt, source, callerId: message.callerId, isDM: message.isDM,
          conversationId: message.conversationExternalId,
          attachments: message.attachments, authorName: message.authorName,
          traceId, parentSpanId,
        });
        return { action: "process", prompt, callerId: message.callerId, role, result };
      } catch (error) {
        return this.handleAgentError(error);
      }
    }

    const policySpan = this.tracer.startSpan("mercury.policy", traceId, parentSpanId);
    const policy = this.services.policy.evaluate(message);
    policySpan.attr("policy.action", policy.action);
    if (policy.action === "deny") policySpan.attr("policy.reason", policy.reason);
    policySpan.end();

    if (policy.action !== "process") return policy;

    try {
      const result = await this.executePrompt({
        prompt: policy.prompt, source, callerId: policy.callerId,
        isDM: message.isDM, conversationId: message.conversationExternalId,
        attachments: message.attachments, authorName: message.authorName,
        traceId, parentSpanId,
      });
      return { ...policy, result };
    } catch (error) {
      return this.handleAgentError(error);
    }
  }

  private handleAgentError(error: unknown): never | PolicyResult {
    if (error instanceof AgentError) {
      switch (error.reason) {
        case "aborted":
          return { action: "deny", reason: "Stopped current run." };
        case "timeout":
          return { action: "deny", reason: "Agent timed out." };
        case "error":
          logger.error("Agent error", error instanceof Error ? error : undefined);
          throw error;
      }
    }
    throw error;
  }

  onShutdown(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook);
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;

    let forceCount = 0;

    const handler = (signal: string) => {
      if (this.shuttingDown) {
        forceCount++;
        if (forceCount >= 1) {
          logger.warn("Second signal received, forcing exit");
          process.exit(1);
        }
        return;
      }
      logger.info("Received signal, starting graceful shutdown", { signal });
      void this.shutdown().then(
        () => process.exit(0),
        (err) => {
          logger.error(
            "Shutdown failed",
            err instanceof Error ? err : undefined,
          );
          process.exit(1);
        },
      );
    };

    process.on("SIGTERM", () => handler("SIGTERM"));
    process.on("SIGINT", () => handler("SIGINT"));
  }

  async shutdown(timeoutMs = 10_000): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const forceTimer = setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, timeoutMs);
    if (forceTimer.unref) forceTimer.unref();

    try {
      logger.info("Shutdown: stopping task scheduler");
      this.services.tasks.stopScheduler();

      logger.info("Shutdown: draining queue");
      const dropped = this.queue.cancelPending();
      if (dropped > 0)
        logger.info("Shutdown: cancelled pending queue entries", {
          count: dropped,
        });

      logger.info("Shutdown: killing agent");
      this.agent.kill();

      const drainTimeout = Math.max(timeoutMs - 2000, 1000);
      const drained = await this.queue.waitForActive(drainTimeout);
      if (!drained) {
        logger.warn("Shutdown: active work did not finish in time");
      }

      if (this.hooks && this.extensionCtx) {
        logger.info("Shutdown: notifying extensions");
        await this.hooks.emit("shutdown", {}, this.extensionCtx);
      }

      for (const hook of this.shutdownHooks) {
        try {
          await hook();
        } catch (err) {
          logger.error(
            "Shutdown hook failed",
            err instanceof Error ? err : undefined,
          );
        }
      }

      logger.info("Shutdown: flushing telemetry");
      await this.tracer.shutdown();

      logger.info("Shutdown: closing database");
      this.database.close();

      logger.info("Shutdown: complete");
    } finally {
      clearTimeout(forceTimer);
    }
  }

  private async executePrompt(opts: {
    prompt: string;
    source: InputSource;
    callerId: string;
    isDM: boolean;
    conversationId: string;
    attachments?: MessageAttachment[];
    authorName?: string;
    traceId: string;
    parentSpanId: string;
  }): Promise<AgentOutput> {
    const { prompt, callerId, isDM, conversationId, attachments, authorName, traceId, parentSpanId } = opts;
    this.services.messages.create("user", prompt, conversationId, attachments);

    return this.queue.enqueue(async () => {
      const workspace = this.workspace;

      if (this.hooks && this.extensionCtx) {
        await this.hooks.emit("workspace_init", { workspace }, this.extensionCtx);
      }

      let extraEnv: Record<string, string> | undefined;
      let extensionSystemPrompt: string | undefined;

      if (this.hooks && this.extensionCtx) {
        const result = await this.hooks.emitBeforeContainer(
          { prompt, callerId, workspace },
          this.extensionCtx,
        );
        if (result?.block) {
          return { text: result.block.reason, files: [] };
        }
        extensionSystemPrompt = result?.systemPrompt;
        if (result?.env) {
          extraEnv = { ...extraEnv, ...result.env };
        }
      }

      const callerRole = this.services.roles.resolveRole(callerId);
      const extensionEnvKeys = new Set<string>();

      if (this.extensionRegistry) {
        const cliExtensions = this.extensionRegistry.getCliExtensions();
        if (cliExtensions.length > 0) {
          const denied = cliExtensions
            .filter((ext) => ext.clis.length > 0 && !this.services.roles.hasPermission(callerRole, ext.name))
            .flatMap((ext) => ext.clis.map((c) => c.name));
          if (denied.length > 0) {
            extraEnv = { ...extraEnv, MERCURY_DENIED_CLIS: denied.join(",") };
          }
        }

        for (const ext of this.extensionRegistry.list()) {
          for (const envDef of ext.envVars) {
            extensionEnvKeys.add(envDef.from);
          }
          if (ext.envVars.length === 0) continue;
          if (ext.permission && !this.services.roles.hasPermission(callerRole, ext.name)) continue;
          for (const envDef of ext.envVars) {
            const value = process.env[envDef.from];
            if (value) {
              const stripped = envDef.from.startsWith("MERCURY_") ? envDef.from.slice(8) : envDef.from;
              extraEnv = { ...extraEnv, [envDef.as ?? stripped]: value };
            }
          }
        }
      }

      for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith("MERCURY_") && value && !extensionEnvKeys.has(key)) {
          extraEnv = { ...extraEnv, [key.slice(8)]: value };
        }
      }

      // Trace: agent execution span, propagate context to pi subprocess
      const agentSpan = this.tracer.startSpan("mercury.agent", traceId, parentSpanId);
      agentSpan.attr("agent.caller_id", callerId);
      agentSpan.attr("agent.caller_role", callerRole);
      agentSpan.attr("agent.conversation_id", conversationId);
      extraEnv = {
        ...extraEnv,
        OTEL_TRACE_ID: traceId,
        OTEL_PARENT_SPAN_ID: agentSpan.id,
      };

      const history = this.services.messages.list(conversationId, 200);
      const startTime = Date.now();

      try {
        const result = await this.agent.run({
          workspace, messages: history, prompt, callerId, callerRole,
          isDM, conversationId, authorName, attachments, extraEnv, extensionSystemPrompt,
        });

        const durationMs = Date.now() - startTime;
        agentSpan.attr("agent.duration_ms", durationMs);

        if (this.hooks && this.extensionCtx) {
          const hookResult = await this.hooks.emitAfterContainer(
            { prompt, reply: result.text, durationMs },
            this.extensionCtx,
          );
          if (hookResult?.suppress) {
            agentSpan.end();
            return { text: "", files: [] };
          }
          if (hookResult?.reply !== undefined) {
            result.text = hookResult.reply;
          }
        }

        this.services.messages.create("assistant", result.text, conversationId);
        agentSpan.end();
        return result;
      } catch (error) {
        agentSpan.end(false);
        throw error;
      }
    });
  }
}
