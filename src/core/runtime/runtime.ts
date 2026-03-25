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
      const result = await this.executePrompt(
        task.prompt,
        "scheduler",
        task.createdBy,
        false,
        task.conversationId,
      );
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
    const msgSpan = this.tracer.startSpan("mercury.message", traceId);
    msgSpan.attr("message.source", source);
    msgSpan.attr("message.platform", message.platform);
    msgSpan.attr("message.caller_id", message.callerId);
    msgSpan.attr("message.is_dm", message.isDM);

    if (source === "cli") {
      const prompt = message.text.trim();
      if (!prompt) { msgSpan.attr("message.action", "ignore"); msgSpan.end(); return { action: "ignore" }; }

      if (this.services.mutes.isMuted(message.callerId)) {
        msgSpan.attr("message.action", "ignore");
        msgSpan.attr("message.reason", "muted");
        msgSpan.end();
        return { action: "ignore" };
      }

      const role = this.services.roles.resolveRole(message.callerId);
      try {
        const result = await this.executePrompt(
          prompt, source, message.callerId, message.isDM,
          message.conversationExternalId, message.attachments, message.authorName,
          traceId, msgSpan.id,
        );
        msgSpan.attr("message.action", "process");
        msgSpan.end();
        return { action: "process", prompt, callerId: message.callerId, role, result };
      } catch (error) {
        msgSpan.end(false);
        return this.handleAgentError(error);
      }
    }

    const policySpan = this.tracer.startSpan("mercury.policy", traceId, msgSpan.id);
    const policy = this.services.policy.evaluate(message);
    policySpan.attr("policy.action", policy.action);
    if (policy.action === "deny") policySpan.attr("policy.reason", policy.reason);
    policySpan.end();

    if (policy.action === "ignore") {
      msgSpan.attr("message.action", "ignore");
      msgSpan.end();
      return policy;
    }

    if (policy.action === "deny") {
      msgSpan.attr("message.action", "deny");
      msgSpan.end();
      return policy;
    }

    try {
      const result = await this.executePrompt(
        policy.prompt,
        source,
        policy.callerId,
        message.isDM,
        message.conversationExternalId,
        message.attachments,
        message.authorName,
        traceId,
        msgSpan.id,
      );
      msgSpan.attr("message.action", "process");
      msgSpan.end();
      return { ...policy, result };
    } catch (error) {
      msgSpan.end(false);
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

  private async executePrompt(
    prompt: string,
    _source: InputSource,
    callerId: string,
    isDM: boolean,
    conversationId: string,
    attachments?: MessageAttachment[],
    authorName?: string,
    traceId?: string,
    parentSpanId?: string,
  ): Promise<AgentOutput> {
    this.services.messages.create("user", prompt, conversationId, attachments);

    return this.queue.enqueue(async () => {
      const workspace = this.workspace;

      if (this.hooks && this.extensionCtx) {
        await this.hooks.emit(
          "workspace_init",
          { workspace },
          this.extensionCtx,
        );
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
            .filter(
              (ext) =>
                ext.clis.length > 0 &&
                !this.services.roles.hasPermission(callerRole, ext.name),
            )
            .flatMap((ext) => ext.clis.map((c) => c.name));
          if (denied.length > 0) {
            extraEnv = {
              ...extraEnv,
              MERCURY_DENIED_CLIS: denied.join(","),
            };
          }
        }

        for (const ext of this.extensionRegistry.list()) {
          for (const envDef of ext.envVars) {
            extensionEnvKeys.add(envDef.from);
          }
          if (ext.envVars.length === 0) continue;
          if (ext.permission && !this.services.roles.hasPermission(callerRole, ext.name))
            continue;
          for (const envDef of ext.envVars) {
            const value = process.env[envDef.from];
            if (value) {
              const stripped = envDef.from.startsWith("MERCURY_")
                ? envDef.from.slice(8)
                : envDef.from;
              const key = envDef.as ?? stripped;
              extraEnv = { ...extraEnv, [key]: value };
            }
          }
        }
      }

      for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith("MERCURY_") && value && !extensionEnvKeys.has(key)) {
          extraEnv = { ...extraEnv, [key.slice(8)]: value };
        }
      }

      const agentSpan = traceId
        ? this.tracer.startSpan("mercury.agent", traceId, parentSpanId)
        : undefined;
      agentSpan?.attr("agent.caller_id", callerId);
      agentSpan?.attr("agent.caller_role", callerRole);
      agentSpan?.attr("agent.conversation_id", conversationId);

      if (traceId) {
        extraEnv = {
          ...extraEnv,
          MERCURY_OTEL_TRACE_ID: traceId,
          MERCURY_OTEL_PARENT_SPAN_ID: agentSpan?.id ?? "",
        };
      }

      const history = this.services.messages.list(conversationId, 200);
      const startTime = Date.now();

      const result = await this.agent.run({
        workspace,
        messages: history,
        prompt,
        callerId,
        callerRole,
        isDM,
        conversationId,
        authorName,
        attachments,
        extraEnv,
        extensionSystemPrompt,
      });

      const durationMs = Date.now() - startTime;

      if (this.hooks && this.extensionCtx) {
        const hookResult = await this.hooks.emitAfterContainer(
          { prompt, reply: result.text, durationMs },
          this.extensionCtx,
        );
        if (hookResult?.suppress) {
          return { text: "", files: [] };
        }
        if (hookResult?.reply !== undefined) {
          result.text = hookResult.reply;
        }
      }

      agentSpan?.attr("agent.duration_ms", durationMs);
      this.services.messages.create("assistant", result.text, conversationId);
      agentSpan?.end();
      return result;
    });
  }
}
