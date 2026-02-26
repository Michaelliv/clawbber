import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { getApiKeyFromPiAuthFile } from "../storage/pi-auth.js";
import type { StoredMessage } from "../types.js";

const START = "---CLAWSOME_CONTAINER_RESULT_START---";
const END = "---CLAWSOME_CONTAINER_RESULT_END---";

export class AgentContainerRunner {
  private readonly runningByGroup = new Map<
    string,
    ChildProcessWithoutNullStreams
  >();
  private readonly abortedGroups = new Set<string>();

  constructor(private readonly config: AppConfig) {}

  isRunning(groupId: string): boolean {
    return this.runningByGroup.has(groupId);
  }

  abort(groupId: string): boolean {
    const proc = this.runningByGroup.get(groupId);
    if (!proc) return false;

    this.abortedGroups.add(groupId);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 2500);
    return true;
  }

  async reply(input: {
    groupId: string;
    groupWorkspace: string;
    messages: StoredMessage[];
    prompt: string;
    callerId: string;
  }): Promise<string> {
    const projectDir = process.cwd();
    const globalDir = path.resolve(this.config.globalDir);
    const groupsRoot = path.resolve(this.config.groupsDir);

    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(groupsRoot, { recursive: true });

    const authFromPi = await getApiKeyFromPiAuthFile({
      provider: this.config.modelProvider,
      authPath: this.config.authPath ?? path.join(globalDir, "auth.json"),
    });

    const authEnv: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_OAUTH_TOKEN: process.env.ANTHROPIC_OAUTH_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };

    if (
      !authEnv.ANTHROPIC_API_KEY &&
      !authEnv.ANTHROPIC_OAUTH_TOKEN &&
      this.config.modelProvider === "anthropic" &&
      authFromPi
    ) {
      authEnv.ANTHROPIC_OAUTH_TOKEN = authFromPi;
    }

    const envPairs = [
      {
        key: "CLAWSOME_MODEL_PROVIDER",
        value: process.env.CLAWSOME_MODEL_PROVIDER,
      },
      { key: "CLAWSOME_MODEL", value: process.env.CLAWSOME_MODEL },
      { key: "CLAWSOME_LOG_LEVEL", value: process.env.CLAWSOME_LOG_LEVEL }, // used by pi CLI inside container
      { key: "ANTHROPIC_API_KEY", value: authEnv.ANTHROPIC_API_KEY },
      { key: "ANTHROPIC_OAUTH_TOKEN", value: authEnv.ANTHROPIC_OAUTH_TOKEN },
      { key: "OPENAI_API_KEY", value: authEnv.OPENAI_API_KEY },
      { key: "HOME", value: "/home/node" },
      { key: "PI_CODING_AGENT_DIR", value: "/home/node/.pi/agent" },
      { key: "CLAWSOME_CALLER_ID", value: input.callerId },
      { key: "CLAWSOME_GROUP_ID", value: input.groupId },
      {
        key: "CLAWSOME_API_URL",
        value: `http://host.docker.internal:${this.config.chatSdkPort}`,
      },
    ].filter((x): x is { key: string; value: string } => Boolean(x.value));

    const args = [
      "run",
      "--rm",
      "-i",
      "-v",
      `${groupsRoot}:/groups`,
      "-v",
      `${globalDir}:/home/node/.pi/agent`,
    ];

    for (const { key, value } of envPairs) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(this.config.agentContainerImage);

    const payload = {
      ...input,
      groupWorkspace: input.groupWorkspace.replace(groupsRoot, "/groups"),
    };

    return new Promise<string>((resolve, reject) => {
      const proc = spawn("docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.runningByGroup.set(input.groupId, proc);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("error", (error) => {
        this.runningByGroup.delete(input.groupId);
        reject(error);
      });

      proc.on("close", (code) => {
        this.runningByGroup.delete(input.groupId);

        if (this.abortedGroups.has(input.groupId)) {
          this.abortedGroups.delete(input.groupId);
          reject(new Error("CLAWSOME_ABORTED"));
          return;
        }

        if (code !== 0) {
          reject(
            new Error(`Container agent failed (${code}): ${stderr || stdout}`),
          );
          return;
        }

        const startIdx = stdout.indexOf(START);
        const endIdx = stdout.indexOf(END);
        if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
          reject(
            new Error(`Failed to parse container result: ${stdout || stderr}`),
          );
          return;
        }

        const jsonText = stdout.slice(startIdx + START.length, endIdx).trim();
        let parsed: { reply?: string };
        try {
          parsed = JSON.parse(jsonText) as { reply?: string };
        } catch {
          reject(
            new Error(`Malformed container output: ${jsonText.slice(0, 200)}`),
          );
          return;
        }
        resolve(parsed.reply ?? "Done.");
      });

      proc.stdin.write(JSON.stringify(payload));
      proc.stdin.end();
    });
  }
}
