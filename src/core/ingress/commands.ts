import fs from "node:fs";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { MercuryCoreRuntime } from "../runtime/runtime.js";
import { compactSession, newSession } from "../runtime/compact.js";

export interface CommandResult {
  handled: boolean;
  reply?: string;
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getSessionFile(core: MercuryCoreRuntime, isDM: boolean, callerId: string, conversationId: string): string {
  const dataDir = path.resolve(path.join(core.workspace, ".."));
  const sessionId = sanitizeFilename(isDM ? `dm-${callerId}` : conversationId);
  return path.join(dataDir, "sessions", sessionId, "session.jsonl");
}

export async function handleCommand(
  core: MercuryCoreRuntime,
  text: string,
  isDM: boolean,
  callerId: string,
  conversationId: string,
): Promise<CommandResult> {
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
    const sessionFile = getSessionFile(core, isDM, callerId, conversationId);
    const lines: string[] = [];

    // Identity & model
    lines.push(`🤖 *${core.config.botUsername}*`);
    lines.push(`🧠 ${core.config.modelProvider}/${core.config.model}`);

    // Session info
    if (fs.existsSync(sessionFile)) {
      try {
        const sm = SessionManager.open(sessionFile);
        const entries = sm.getEntries();
        const messages = entries.filter((e: { type: string }) => e.type === "message");
        const stat = fs.statSync(sessionFile);
        const sizeKb = Math.round(stat.size / 1024);
        lines.push(`📚 Session: ${messages.length} messages (${sizeKb}KB)`);
      } catch {
        lines.push("📚 Session: error reading");
      }
    } else {
      lines.push("📚 Session: none");
    }

    // Agent state
    const agentState = core.agent.isRunning ? "busy" : "idle";
    const queueDepth = core.queue.pendingCount;
    lines.push(`⚙️ Agent: ${agentState}${queueDepth > 0 ? ` · Queue: ${queueDepth}` : ""}`);

    // Trigger config
    const patterns = core.config.triggerPatterns.split(",").map((s: string) => s.trim()).join(", ");
    lines.push(`👥 Triggers: ${patterns}`);

    // Extensions
    const extCount = core.extensionRegistry?.list().length ?? 0;
    if (extCount > 0) {
      const extNames = core.extensionRegistry!.list().map((e: { name: string }) => e.name).join(", ");
      lines.push(`🧩 Extensions: ${extNames}`);
    }

    return { handled: true, reply: lines.join("\n") };
  }

  if (cmd === "/stop") {
    const stopped = core.agent.abort();
    const dropped = core.queue.cancelPending();
    if (stopped) return { handled: true, reply: `Stopped.${dropped > 0 ? ` Dropped ${dropped} queued.` : ""}` };
    if (dropped > 0) return { handled: true, reply: `Dropped ${dropped} queued request(s).` };
    return { handled: true, reply: "No active run." };
  }

  if (cmd === "/compact") {
    const sessionFile = getSessionFile(core, isDM, callerId, conversationId);
    const result = await compactSession(sessionFile, core.config);
    core.services.messages.setSessionBoundary(conversationId);
    if (result.compacted) return { handled: true, reply: "Compacted." };
    if (result.error === "Already compacted") return { handled: true, reply: "Already compacted." };
    return { handled: true, reply: result.error ? `Compact: ${result.error}` : "Nothing to compact." };
  }

  if (cmd === "/new") {
    const sessionFile = getSessionFile(core, isDM, callerId, conversationId);
    newSession(sessionFile);
    core.services.messages.setSessionBoundary(conversationId);
    return { handled: true, reply: "New session started." };
  }

  if (cmd === "/config" && sub === "set" && parts.length >= 4) {
    const key = parts[2];
    const value = parts.slice(3).join(" ");
    core.services.config.set(key, value, "admin");
    return { handled: true, reply: `✅ *${key}* = ${value}` };
  }

  if (cmd === "/config") {
    const key = parts[1];
    if (key) {
      const val = core.services.config.get(key);
      return { handled: true, reply: val ? `*${key}* = ${val}` : `*${key}* not set` };
    }
    const all = core.services.config.list();
    return {
      handled: true,
      reply: all.length === 0
        ? "No config set."
        : `Config:\n${all.map((c: { key: string; value: string }) => `• *${c.key}* = ${c.value}`).join("\n")}`,
    };
  }

  return { handled: false };
}
