import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { loadWorkspaceConfig, mergeWorkspaceConfig } from "../config.js";
import { compactSession, newSession } from "../runtime/compact.js";
import type { MercuryCoreRuntime } from "../runtime/runtime.js";

const pkg = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "../../../package.json"), "utf-8"),
);

export interface CommandResult {
  handled: boolean;
  reply?: string;
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

import { resolveProjectPath } from "../config.js";

function getSessionFile(
  core: MercuryCoreRuntime,
  isDM: boolean,
  callerId: string,
  conversationId: string,
  workspaceName: string,
): string {
  const sessionId = sanitizeFilename(isDM ? `dm-${callerId}` : conversationId);
  const wsDir = path.join(
    resolveProjectPath(core.config.workspacesDir),
    workspaceName,
  );
  return path.join(wsDir, "sessions", sessionId, "session.jsonl");
}

export async function handleCommand(
  core: MercuryCoreRuntime,
  text: string,
  isDM: boolean,
  callerId: string,
  conversationId: string,
  workspaceId: number,
  workspaceName: string,
): Promise<CommandResult> {
  const wsId = workspaceId;
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const sub = parts[1]?.toLowerCase();

  if (cmd === "/help") {
    return {
      handled: true,
      reply: [
        "*/help* — this message",
        "*/status* — show status",
        "*/stop* — abort current run",
        "*/compact* — summarize session history",
        "*/new* — start fresh session",
        "*/config set <key> <value>* — set config",
        "*/config [key]* — show config",
      ].join("\n"),
    };
  }

  if (cmd === "/status") {
    const sessionFile = getSessionFile(
      core,
      isDM,
      callerId,
      conversationId,
      workspaceName,
    );
    const lines: string[] = [];

    // Load workspace-merged config for accurate status
    const wsOverrides = loadWorkspaceConfig(
      path.join(core.config.workspacesDir, workspaceName),
    );
    const effectiveConfig = mergeWorkspaceConfig(core.config, wsOverrides);

    lines.push(`🪽 Mercury ${pkg.version}`);
    if (workspaceName) lines.push(`📁 Workspace: ${workspaceName}`);
    lines.push(`🧠 ${effectiveConfig.modelProvider}/${effectiveConfig.model}`);

    if (fs.existsSync(sessionFile)) {
      try {
        const sm = SessionManager.open(sessionFile);
        const entries = sm.getEntries();
        const compactions = entries.filter(
          (e: { type: string }) => e.type === "compaction",
        ).length;
        const { session } = await createAgentSession({
          sessionManager: sm,
          cwd: sm.getCwd(),
        });
        const stats = session.getSessionStats();
        const fmt = (n: number) =>
          n > 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
        const totalInput = stats.tokens.input + stats.tokens.cacheRead;
        lines.push(
          `📚 Session: ${stats.totalMessages} msgs · ↑${fmt(totalInput)} ↓${fmt(stats.tokens.output)}`,
        );
        if (stats.tokens.cacheRead > 0) {
          const cacheHitPct = Math.round(
            (stats.tokens.cacheRead / totalInput) * 100,
          );
          lines.push(`🗄️ Cache: ${cacheHitPct}% hit`);
        }
        if (stats.cost > 0) lines.push(`💰 Cost: $${stats.cost.toFixed(3)}`);
        lines.push(`🧹 Compactions: ${compactions}`);
      } catch {
        lines.push("📚 Session: error reading");
      }
    } else {
      lines.push("📚 Session: none");
    }

    const agentState = core.agent.isRunning ? "busy" : "idle";
    const queueDepth = core.queue.pendingCount;
    lines.push(
      `⚙️ Agent: ${agentState}${queueDepth > 0 ? ` · Queue: ${queueDepth}` : ""}`,
    );

    const patterns = effectiveConfig.triggerPatterns
      .split(",")
      .map((s: string) => s.trim())
      .join(", ");
    lines.push(`👥 Triggers: ${patterns}`);

    const extCount = core.extensionRegistry?.list().length ?? 0;
    if (extCount > 0) {
      const extNames = core
        .extensionRegistry!.list()
        .map((e: { name: string }) => e.name)
        .join(", ");
      lines.push(`🧩 Extensions: ${extNames}`);
    }

    return { handled: true, reply: lines.join("\n") };
  }

  if (cmd === "/stop") {
    const stopped = core.agent.abort();
    const dropped = core.queue.cancelPending();
    if (stopped)
      return {
        handled: true,
        reply: `Stopped.${dropped > 0 ? ` Dropped ${dropped} queued.` : ""}`,
      };
    if (dropped > 0)
      return { handled: true, reply: `Dropped ${dropped} queued request(s).` };
    return { handled: true, reply: "No active run." };
  }

  if (cmd === "/compact") {
    const sessionFile = getSessionFile(
      core,
      isDM,
      callerId,
      conversationId,
      workspaceName,
    );
    const result = await compactSession(sessionFile, core.config);
    core.services.messages.setSessionBoundary(wsId, conversationId);
    if (result.compacted) return { handled: true, reply: "Compacted." };
    if (result.error === "Already compacted")
      return { handled: true, reply: "Already compacted." };
    return {
      handled: true,
      reply: result.error ? `Compact: ${result.error}` : "Nothing to compact.",
    };
  }

  if (cmd === "/new") {
    const sessionFile = getSessionFile(
      core,
      isDM,
      callerId,
      conversationId,
      workspaceName,
    );
    newSession(sessionFile);
    core.services.messages.setSessionBoundary(wsId, conversationId);
    return { handled: true, reply: "New session started." };
  }

  if (cmd === "/config" && sub === "set" && parts.length >= 4) {
    const key = parts[2];
    const value = parts.slice(3).join(" ");
    core.services.config.set(wsId, key, value, "admin");
    return { handled: true, reply: `✅ *${key}* = ${value}` };
  }

  if (cmd === "/config") {
    const key = parts[1];
    if (key) {
      const val = core.services.config.get(wsId, key);
      return {
        handled: true,
        reply: val ? `*${key}* = ${val}` : `*${key}* not set`,
      };
    }
    const all = core.services.config.list(wsId);
    return {
      handled: true,
      reply:
        all.length === 0
          ? "No config set."
          : `Config:\n${all.map((c: { key: string; value: string }) => `• *${c.key}* = ${c.value}`).join("\n")}`,
    };
  }

  return { handled: false };
}
