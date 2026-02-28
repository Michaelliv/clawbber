#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { authenticate } from "./whatsapp-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "../..");
const CWD = process.cwd();

// Embedded templates
const ENV_TEMPLATE = `# Required: one provider key
ANTHROPIC_API_KEY=
# OPENAI_API_KEY=

# Identity
MERCURY_CHATSDK_USERNAME=mercury
MERCURY_CHATSDK_PORT=3000
MERCURY_TRIGGER_PATTERNS=@Mercury,Mercury

# Model
MERCURY_MODEL_PROVIDER=anthropic
MERCURY_MODEL=claude-sonnet-4-20250514

# Runtime
MERCURY_DATA_DIR=.mercury
MERCURY_MAX_CONCURRENCY=2
MERCURY_LOG_LEVEL=info

# Containerized agent runtime
MERCURY_AGENT_CONTAINER_IMAGE=mercury-agent:latest

# Optional: admin caller IDs (comma-separated)
# MERCURY_ADMINS=

# WhatsApp ingress (Baileys socket)
MERCURY_ENABLE_WHATSAPP=false

# Optional Slack ingress
# SLACK_BOT_TOKEN=
# SLACK_SIGNING_SECRET=

# Optional Discord ingress
# DISCORD_BOT_TOKEN=
# DISCORD_PUBLIC_KEY=
# DISCORD_APPLICATION_ID=
`;

const AGENTS_MD_TEMPLATE = `# Mercury Agent Instructions

You are a helpful AI assistant running inside a chat platform (WhatsApp, Slack, or Discord).

## Guidelines

1. **Be concise** — Chat messages should be readable on mobile
2. **Use markdown sparingly** — Not all chat platforms render it well
3. **Cite sources** — When searching the web, mention where information came from
4. **Ask for clarification** — If a request is ambiguous, ask before acting

## Web Search

Use \`agent-browser\` with Brave Search. **Always include the user-agent to avoid CAPTCHAs:**

\`\`\`bash
agent-browser close 2>/dev/null
agent-browser --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" \\
  open "https://search.brave.com/search?q=your+query+here"
agent-browser get text body
\`\`\`

To fetch content from a URL:

\`\`\`bash
agent-browser open "https://example.com"
agent-browser wait --load networkidle
agent-browser get text body
\`\`\`

**Note:** Google, DuckDuckGo, and Bing block automated access. Use Brave or Startpage.

## Limitations

- Running in a container with limited resources
- Long-running tasks may time out
- No persistent memory between conversations

## Mercury Documentation

When users ask about mercury's capabilities, configuration, or how things work, read the relevant docs:

| Path | Contents |
|------|----------|
| /docs/mercury/README.md | Overview, commands, triggers, permissions, tasks, config |
| /docs/mercury/docs/ingress.md | Adapter message flow (WhatsApp, Slack, Discord) |
| /docs/mercury/docs/media/ | Media handling (downloads, attachments) |
| /docs/mercury/docs/subagents.md | Delegating to sub-agents |
| /docs/mercury/docs/web-search.md | Web search capabilities |
| /docs/mercury/docs/auth/ | Platform authentication |
| /docs/mercury/docs/rate-limiting.md | Rate limiting configuration |

Read these lazily — only when the user asks about a specific topic.

## Sub-agents

You can delegate tasks to specialized sub-agents:

| Agent | Purpose | Model |
|-------|---------|-------|
| explore | Fast codebase reconnaissance | Haiku |
| worker | General-purpose tasks | Sonnet |

### Single Agent
"Use explore to find all authentication code"

### Parallel Execution
"Run 2 workers in parallel: one to refactor models, one to update tests"

### Chained Workflow
"Use a chain: first have explore find the code, then have worker implement the fix"
`;

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"),
    );
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function copySourceFile(srcRelative: string, destRelative: string): void {
  const src = join(PACKAGE_ROOT, srcRelative);
  const dest = join(CWD, destRelative);

  if (!existsSync(src)) {
    console.error(`Error: Source file not found: ${srcRelative}`);
    process.exit(1);
  }

  const content = readFileSync(src, "utf-8");
  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  writeFileSync(dest, content);
  console.log(`  ✓ ${destRelative}`);
}

function loadEnvFile(envPath: string): Record<string, string> {
  const content = readFileSync(envPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      vars[match[1]] = match[2];
    }
  }
  return vars;
}

// Commands
function initAction(): void {
  console.log("🪽 Initializing mercury project...\n");

  // Create .env if it doesn't exist
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, ENV_TEMPLATE);
    console.log("  ✓ .env");
  } else {
    console.log("  • .env (already exists)");
  }

  // Create data directories
  const dirs = [".mercury", ".mercury/groups", ".mercury/global"];
  for (const dir of dirs) {
    const fullPath = join(CWD, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      console.log(`  ✓ ${dir}/`);
    }
  }

  // Create AGENTS.md for the agent
  const agentsMdPath = join(CWD, ".mercury/global/AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, AGENTS_MD_TEMPLATE);
    console.log("  ✓ .mercury/global/AGENTS.md");
  } else {
    console.log("  • .mercury/global/AGENTS.md (already exists)");
  }

  // Copy subagent extension
  console.log("\nCopying subagent extension:");
  const extensionsDir = join(CWD, ".mercury/global/extensions/subagent");
  mkdirSync(extensionsDir, { recursive: true });
  const srcExtDir = join(PACKAGE_ROOT, "resources/extensions/subagent");
  for (const file of readdirSync(srcExtDir)) {
    copyFileSync(join(srcExtDir, file), join(extensionsDir, file));
    console.log(`  ✓ .mercury/global/extensions/subagent/${file}`);
  }

  // Copy agent definitions
  console.log("\nCopying agent definitions:");
  const agentsDir = join(CWD, ".mercury/global/agents");
  mkdirSync(agentsDir, { recursive: true });
  const srcAgentsDir = join(PACKAGE_ROOT, "resources/agents");
  for (const file of readdirSync(srcAgentsDir)) {
    copyFileSync(join(srcAgentsDir, file), join(agentsDir, file));
    console.log(`  ✓ .mercury/global/agents/${file}`);
  }

  // Create container directory and files
  const containerDir = join(CWD, "container");
  if (!existsSync(containerDir)) {
    mkdirSync(containerDir, { recursive: true });
  }

  const dockerfilePath = join(CWD, "container/Dockerfile");
  if (!existsSync(dockerfilePath)) {
    copyFileSync(join(PACKAGE_ROOT, "container/Dockerfile"), dockerfilePath);
    console.log("  ✓ container/Dockerfile");
  }

  const buildScriptPath = join(CWD, "container/build.sh");
  if (!existsSync(buildScriptPath)) {
    copyFileSync(join(PACKAGE_ROOT, "container/build.sh"), buildScriptPath);
    chmodSync(buildScriptPath, 0o755);
    console.log("  ✓ container/build.sh");
  }

  // Copy source files needed for container build
  console.log("\nCopying container runtime files:");
  copySourceFile(
    "src/agent/container-entry.ts",
    "src/agent/container-entry.ts",
  );
  copySourceFile("src/cli/mercury-ctl.ts", "src/cli/mercury-ctl.ts");
  copySourceFile("src/types.ts", "src/types.ts");

  // Build container
  console.log("\n📦 Building container image...\n");
  const buildResult = spawnSync("bash", [buildScriptPath], {
    stdio: "inherit",
    cwd: CWD,
  });

  if (buildResult.status !== 0) {
    console.error(
      "\n⚠️  Container build failed. You can retry with 'mercury build'",
    );
  }

  console.log("\n🪽 Initialization complete!");
  console.log("\nNext steps:");
  console.log("  1. Edit .env to set your API keys and enable adapters");
  console.log("  2. Run 'mercury run' to start");
}

async function runAction(): Promise<void> {
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    console.error("Error: .env file not found in current directory.");
    console.error("Run 'mercury init' first, or cd into your mercury project.");
    process.exit(1);
  }

  const imageCheck = spawnSync(
    "docker",
    ["image", "inspect", "mercury-agent:latest"],
    {
      stdio: "pipe",
    },
  );
  if (imageCheck.status !== 0) {
    console.error("Error: Container image 'mercury-agent:latest' not found.");
    console.error("Run 'mercury build' to build it.");
    process.exit(1);
  }

  const envVars = loadEnvFile(envPath);

  console.log("🪽 Starting mercury...\n");

  const entryPoint = join(PACKAGE_ROOT, "src/chat-sdk.ts");

  const child = spawn("bun", ["run", entryPoint], {
    stdio: "inherit",
    cwd: CWD,
    env: { ...process.env, ...envVars },
  });

  child.on("error", (err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

function buildAction(): void {
  const buildScript = join(CWD, "container/build.sh");

  if (!existsSync(buildScript)) {
    console.error("Error: container/build.sh not found in current directory.");
    console.error("Run 'mercury init' first.");
    process.exit(1);
  }

  const result = spawnSync("bash", [buildScript], {
    stdio: "inherit",
    cwd: CWD,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function statusAction(): void {
  console.log("🪽 mercury status\n");
  console.log(`Project directory: ${CWD}\n`);

  const envPath = join(CWD, ".env");
  const hasEnv = existsSync(envPath);
  console.log(
    `Configuration:   ${hasEnv ? "✓ .env exists" : "✗ .env missing (run 'mercury init')"}`,
  );

  const hasContainerFiles = existsSync(join(CWD, "container/Dockerfile"));
  console.log(
    `Container files: ${hasContainerFiles ? "✓ present" : "✗ missing (run 'mercury init')"}`,
  );

  const imageCheck = spawnSync(
    "docker",
    ["image", "inspect", "mercury-agent:latest"],
    {
      stdio: "pipe",
    },
  );
  const hasImage = imageCheck.status === 0;
  console.log(
    `Container image: ${hasImage ? "✓ mercury-agent:latest" : "✗ not built (run 'mercury build')"}`,
  );

  if (hasEnv) {
    console.log("\nConfigured adapters:");
    const envContent = readFileSync(envPath, "utf-8");

    const hasWhatsApp = /MERCURY_ENABLE_WHATSAPP\s*=\s*true/i.test(envContent);
    const hasSlack = /^[^#]*SLACK_BOT_TOKEN=\S+/m.test(envContent);
    const hasDiscord = /^[^#]*DISCORD_BOT_TOKEN=\S+/m.test(envContent);

    console.log(`  WhatsApp: ${hasWhatsApp ? "✓ enabled" : "○ disabled"}`);
    console.log(
      `  Slack:    ${hasSlack ? "✓ configured" : "○ not configured"}`,
    );
    console.log(
      `  Discord:  ${hasDiscord ? "✓ configured" : "○ not configured"}`,
    );

    const portMatch = envContent.match(/MERCURY_CHATSDK_PORT\s*=\s*(\d+)/);
    const port = portMatch ? portMatch[1] : "3000";

    const portCheck = spawnSync("lsof", ["-i", `:${port}`, "-t"], {
      stdio: "pipe",
    });
    const isRunning =
      portCheck.status === 0 && portCheck.stdout.toString().trim().length > 0;
    console.log(
      `\nStatus: ${isRunning ? `🟢 running (port ${port})` : "⚪ not running"}`,
    );
  }
}

// CLI setup
const program = new Command();

program
  .name("mercury")
  .description("Personal AI assistant for chat platforms")
  .version(getVersion());

program
  .command("init")
  .description("Initialize a new mercury project in current directory")
  .action(initAction);

program
  .command("run")
  .description("Start the chat adapters (WhatsApp/Slack/Discord)")
  .action(runAction);

program
  .command("build")
  .description("Build the agent container image")
  .action(buildAction);

program
  .command("status")
  .description("Show current status and configuration")
  .action(statusAction);

// Auth subcommand
const authCommand = program
  .command("auth")
  .description("Authenticate with chat platforms");

authCommand
  .command("whatsapp")
  .description("Authenticate with WhatsApp via QR code or pairing code")
  .option("--pairing-code", "Use pairing code instead of QR code")
  .option(
    "--phone <number>",
    "Phone number for pairing code (e.g., 14155551234)",
  )
  .action(async (options: { pairingCode?: boolean; phone?: string }) => {
    const envPath = join(CWD, ".env");
    let dataDir = ".mercury";

    if (existsSync(envPath)) {
      const envVars = loadEnvFile(envPath);
      if (envVars.MERCURY_DATA_DIR) {
        dataDir = envVars.MERCURY_DATA_DIR;
      }
    }

    const authDir =
      process.env.MERCURY_WHATSAPP_AUTH_DIR ||
      join(CWD, dataDir, "whatsapp-auth");
    const statusDir = join(CWD, dataDir);

    try {
      await authenticate({
        authDir,
        statusDir,
        usePairingCode: options.pairingCode,
        phoneNumber: options.phone,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Authentication failed:", message);
      process.exit(1);
    }
  });

program.parse();
