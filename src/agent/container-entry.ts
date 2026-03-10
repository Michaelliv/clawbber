import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { MessageAttachment, StoredMessage } from "../types.js";

type Payload = {
  spaceId: string;
  spaceWorkspace: string;
  messages: StoredMessage[];
  prompt: string;
  callerRole?: string;
  authorName?: string;
  attachments?: MessageAttachment[];
};

const START = "---MERCURY_CONTAINER_RESULT_START---";
const END = "---MERCURY_CONTAINER_RESULT_END---";

function formatContextTimestamp(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function buildSystemPrompt(): string {
  return `You are Mercury, a concise personal AI assistant.
Prioritize practical outputs and explicit assumptions.

Files received from users (images, documents, voice notes) are saved to the \`inbox/\` directory in the current workspace. To send files back with your reply, write them to the \`outbox/\` directory — any files created or modified there during this run will be automatically attached to your response.

You are Mercury, built from https://github.com/Michaelliv/mercury. When users ask about Mercury — what it can do, how to configure it, scheduling, permissions, extensions, or anything about the platform — you MUST read from \`/docs/mercury/\` before answering. Start with \`/docs/mercury/README.md\` for an overview, then check \`/docs/mercury/docs/\` for detailed guides.

## Permissions & Security
Each run is triggered by a specific caller with a role (admin or member). The caller's identity and role are provided in the user prompt as a <caller /> tag.
- **admin**: Full access to all tools and extensions.
- **member**: Limited access. Some tools and extensions are restricted.
If a tool call is blocked with "Permission denied", this is a hard security boundary. Do NOT attempt to achieve the same result through alternative means — no curl, no direct API calls, no workarounds. Simply inform the user they do not have permission.

## Moderation
You can mute users who are being abusive, spamming, trying to exfiltrate secrets, or deliberately wasting the group's resources by triggering you for pointless nonsense. Use \`mrctl mute\` when you judge it necessary — you don't need to wait for an admin to ask. Warn the user first, then mute if they continue.`;
}

/**
 * Format attachment information for the prompt as XML.
 * Converts absolute paths to container-relative paths.
 */
function formatAttachments(
  attachments: MessageAttachment[] | undefined,
): string | null {
  if (!attachments || attachments.length === 0) return null;

  const entries = attachments.map((att) => {
    // Convert host path to container path
    const containerPath = att.path.replace(/^.*\/spaces\//, "/spaces/");

    const attrs = [
      `type="${att.type}"`,
      `path="${containerPath}"`,
      `mime="${att.mimeType}"`,
    ];

    if (att.sizeBytes) {
      attrs.push(`size="${att.sizeBytes}"`);
    }
    if (att.filename) {
      attrs.push(`filename="${att.filename}"`);
    }

    return `  <attachment ${attrs.join(" ")} />`;
  });

  return ["<attachments>", ...entries, "</attachments>"].join("\n");
}

function buildPrompt(payload: Payload): string {
  const parts: string[] = [];

  // Add caller identity
  const callerId = process.env.CALLER_ID ?? "unknown";
  const role = payload.callerRole ?? "member";
  const space = payload.spaceId ?? "unknown";
  const nameAttr = payload.authorName ? ` name="${payload.authorName}"` : "";
  parts.push(
    `<caller id="${callerId}"${nameAttr} role="${role}" space="${space}" />`,
  );
  parts.push("");

  // Add ambient messages context
  const ambientEntries = payload.messages
    .filter((m) => m.role === "ambient")
    .map((m) => {
      const ts = formatContextTimestamp(m.createdAt);
      return `  <message role="space" timestamp="${ts}">\n${m.content}\n  </message>`;
    });

  if (ambientEntries.length > 0) {
    parts.push("<ambient_messages>");
    parts.push(...ambientEntries);
    parts.push("</ambient_messages>");
    parts.push("");
  }

  // Add attachments from current message
  const attachmentsXml = formatAttachments(payload.attachments);
  if (attachmentsXml) {
    parts.push(attachmentsXml);
    parts.push("");
  }

  // Add the prompt
  parts.push(payload.prompt);

  return parts.join("\n");
}

function runPi(payload: Payload): Promise<string> {
  return new Promise((resolve, reject) => {
    const sessionFile = path.join(
      payload.spaceWorkspace,
      ".mercury.session.jsonl",
    );

    // Combine base system prompt with extension-injected fragments
    let systemPrompt = buildSystemPrompt();
    const extPrompt = process.env.MERCURY_EXT_SYSTEM_PROMPT;
    if (extPrompt) {
      systemPrompt = `${systemPrompt}\n\n${extPrompt}`;
    }

    const args = [
      "--print",
      "--session",
      sessionFile,
      "--provider",
      process.env.MODEL_PROVIDER || "anthropic",
      "--model",
      process.env.MODEL || "claude-opus-4-6",
      "-e",
      "/app/src/extensions/permission-guard.ts",
      "--append-system-prompt",
      systemPrompt,
      buildPrompt(payload),
    ];

    const proc = spawn("pi", args, {
      cwd: payload.spaceWorkspace,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    proc.on("error", (error) => reject(error));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pi CLI failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim() || "Done.");
    });
  });
}

async function main() {
  const input = readFileSync(0, "utf8");
  let payload: Payload;
  try {
    payload = JSON.parse(input) as Payload;
  } catch {
    process.stderr.write("Failed to parse input payload\n");
    process.exit(1);
  }

  const reply = await runPi(payload);

  process.stdout.write(`${START}\n`);
  process.stdout.write(JSON.stringify({ reply }));
  process.stdout.write(`\n${END}\n`);
}

main().catch((error) => {
  process.stderr.write(String(error));
  process.exit(1);
});
