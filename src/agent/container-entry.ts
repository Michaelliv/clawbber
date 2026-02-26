import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { StoredMessage } from "../types.js";

type Payload = {
  groupId: string;
  groupWorkspace: string;
  messages: StoredMessage[];
  prompt: string;
};

const START = "---CLAWSOME_CONTAINER_RESULT_START---";
const END = "---CLAWSOME_CONTAINER_RESULT_END---";

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
  return [
    "You are Clawsome, a concise personal AI assistant.",
    "Prioritize practical outputs and explicit assumptions.",
  ].join("\n");
}

function buildPrompt(payload: Payload): string {
  const ambientEntries = payload.messages
    .filter((m) => m.role === "ambient")
    .map((m) => {
      const ts = formatContextTimestamp(m.createdAt);
      return `<message role="group" timestamp="${ts}">\n${m.content}\n</message>`;
    });

  if (ambientEntries.length === 0) return payload.prompt;

  return [
    "<ambient_messages>",
    ...ambientEntries,
    "</ambient_messages>",
    "",
    payload.prompt,
  ].join("\n");
}

function runPi(payload: Payload): Promise<string> {
  return new Promise((resolve, reject) => {
    const sessionFile = path.join(payload.groupWorkspace, ".clawsome.session.jsonl");

    const args = [
      "--print",
      "--session",
      sessionFile,
      "--provider",
      process.env.CLAWSOME_MODEL_PROVIDER || "anthropic",
      "--model",
      process.env.CLAWSOME_MODEL || "claude-sonnet-4-20250514",
      "--append-system-prompt",
      buildSystemPrompt(),
      buildPrompt(payload),
    ];

    const proc = spawn("pi", args, {
      cwd: payload.groupWorkspace,
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
