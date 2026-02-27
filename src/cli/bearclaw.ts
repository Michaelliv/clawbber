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
BEARCLAW_CHATSDK_USERNAME=bearclaw
BEARCLAW_CHATSDK_PORT=3000
BEARCLAW_TRIGGER_PATTERNS=@BearClaw,BearClaw

# Model
BEARCLAW_MODEL_PROVIDER=anthropic
BEARCLAW_MODEL=claude-sonnet-4-20250514

# Runtime
BEARCLAW_DATA_DIR=.bearclaw
BEARCLAW_MAX_CONCURRENCY=2
BEARCLAW_LOG_LEVEL=info

# Containerized agent runtime
BEARCLAW_AGENT_CONTAINER_IMAGE=bearclaw-agent:latest

# Optional: admin caller IDs (comma-separated)
# BEARCLAW_ADMINS=

# WhatsApp ingress (Baileys socket)
BEARCLAW_ENABLE_WHATSAPP=false

# Optional Slack ingress
# SLACK_BOT_TOKEN=
# SLACK_SIGNING_SECRET=

# Optional Discord ingress
# DISCORD_BOT_TOKEN=
# DISCORD_PUBLIC_KEY=
# DISCORD_APPLICATION_ID=
`;

const DOCKERFILE_TEMPLATE = `# BearClaw Agent Container
FROM oven/bun:1.3

# Install Chromium dependencies (from agent-browser install --with-deps)
RUN apt-get update && apt-get install -y --no-install-recommends \\
    libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 \\
    libxcomposite1 libxdamage1 libxfixes3 libxi6 \\
    libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 \\
    libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 \\
    libfontconfig1 libdbus-1-3 libnss3 libnspr4 libatk-bridge2.0-0 \\
    libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 libxshmfence1 libgbm1 \\
    && rm -rf /var/lib/apt/lists/*

# Install pi CLI and agent-browser
RUN bun add -g @mariozechner/pi-coding-agent agent-browser

# Install Chromium browser
RUN bunx playwright install chromium

WORKDIR /app

# Copy container runtime files
COPY src/agent/container-entry.ts /app/src/agent/container-entry.ts
COPY src/cli/bearclaw-ctl.ts /app/src/cli/bearclaw-ctl.ts
COPY src/types.ts /app/src/types.ts

ENTRYPOINT ["bun", "run", "/app/src/agent/container-entry.ts"]
`;

const BUILD_SCRIPT_TEMPLATE = `#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

IMAGE_NAME="bearclaw-agent"
TAG="\${1:-latest}"

echo "Building BearClaw agent container image..."
echo "Image: \${IMAGE_NAME}:\${TAG}"

docker build -f container/Dockerfile -t "\${IMAGE_NAME}:\${TAG}" .

echo ""
echo "Build complete: \${IMAGE_NAME}:\${TAG}"
`;

const AGENTS_MD_TEMPLATE = `# BearClaw Agent Instructions

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

## BearClaw Documentation

When users ask about bearclaw's capabilities, configuration, or how things work, read the relevant docs:

| Path | Contents |
|------|----------|
| /docs/bearclaw/README.md | Overview, commands, triggers, permissions, tasks, config |
| /docs/bearclaw/docs/ingress.md | Adapter message flow (WhatsApp, Slack, Discord) |
| /docs/bearclaw/docs/media/ | Media handling (downloads, attachments) |
| /docs/bearclaw/docs/subagents.md | Delegating to sub-agents |
| /docs/bearclaw/docs/web-search.md | Web search capabilities |
| /docs/bearclaw/docs/auth/ | Platform authentication |
| /docs/bearclaw/docs/rate-limiting.md | Rate limiting configuration |

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
  console.log("🐻 Initializing bearclaw project...\n");

  // Create .env if it doesn't exist
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, ENV_TEMPLATE);
    console.log("  ✓ .env");
  } else {
    console.log("  • .env (already exists)");
  }

  // Create data directories
  const dirs = [".bearclaw", ".bearclaw/groups", ".bearclaw/global"];
  for (const dir of dirs) {
    const fullPath = join(CWD, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      console.log(`  ✓ ${dir}/`);
    }
  }

  // Create AGENTS.md for the agent
  const agentsMdPath = join(CWD, ".bearclaw/global/AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, AGENTS_MD_TEMPLATE);
    console.log("  ✓ .bearclaw/global/AGENTS.md");
  } else {
    console.log("  • .bearclaw/global/AGENTS.md (already exists)");
  }

  // Copy subagent extension
  console.log("\nCopying subagent extension:");
  const extensionsDir = join(CWD, ".bearclaw/global/extensions/subagent");
  mkdirSync(extensionsDir, { recursive: true });
  const srcExtDir = join(PACKAGE_ROOT, "resources/extensions/subagent");
  for (const file of readdirSync(srcExtDir)) {
    copyFileSync(join(srcExtDir, file), join(extensionsDir, file));
    console.log(`  ✓ .bearclaw/global/extensions/subagent/${file}`);
  }

  // Copy agent definitions
  console.log("\nCopying agent definitions:");
  const agentsDir = join(CWD, ".bearclaw/global/agents");
  mkdirSync(agentsDir, { recursive: true });
  const srcAgentsDir = join(PACKAGE_ROOT, "resources/agents");
  for (const file of readdirSync(srcAgentsDir)) {
    copyFileSync(join(srcAgentsDir, file), join(agentsDir, file));
    console.log(`  ✓ .bearclaw/global/agents/${file}`);
  }

  // Create container directory and files
  const containerDir = join(CWD, "container");
  if (!existsSync(containerDir)) {
    mkdirSync(containerDir, { recursive: true });
  }

  const dockerfilePath = join(CWD, "container/Dockerfile");
  if (!existsSync(dockerfilePath)) {
    writeFileSync(dockerfilePath, DOCKERFILE_TEMPLATE);
    console.log("  ✓ container/Dockerfile");
  }

  const buildScriptPath = join(CWD, "container/build.sh");
  if (!existsSync(buildScriptPath)) {
    writeFileSync(buildScriptPath, BUILD_SCRIPT_TEMPLATE);
    chmodSync(buildScriptPath, 0o755);
    console.log("  ✓ container/build.sh");
  }

  // Copy source files needed for container build
  console.log("\nCopying container runtime files:");
  copySourceFile(
    "src/agent/container-entry.ts",
    "src/agent/container-entry.ts",
  );
  copySourceFile("src/cli/bearclaw-ctl.ts", "src/cli/bearclaw-ctl.ts");
  copySourceFile("src/types.ts", "src/types.ts");

  // Build container
  console.log("\n📦 Building container image...\n");
  const buildResult = spawnSync("bash", [buildScriptPath], {
    stdio: "inherit",
    cwd: CWD,
  });

  if (buildResult.status !== 0) {
    console.error(
      "\n⚠️  Container build failed. You can retry with 'bearclaw build'",
    );
  }

  console.log("\n🐻 Initialization complete!");
  console.log("\nNext steps:");
  console.log("  1. Edit .env to set your API keys and enable adapters");
  console.log("  2. Run 'bearclaw run' to start");
}

async function runAction(): Promise<void> {
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    console.error("Error: .env file not found in current directory.");
    console.error(
      "Run 'bearclaw init' first, or cd into your bearclaw project.",
    );
    process.exit(1);
  }

  const imageCheck = spawnSync(
    "docker",
    ["image", "inspect", "bearclaw-agent:latest"],
    {
      stdio: "pipe",
    },
  );
  if (imageCheck.status !== 0) {
    console.error("Error: Container image 'bearclaw-agent:latest' not found.");
    console.error("Run 'bearclaw build' to build it.");
    process.exit(1);
  }

  const envVars = loadEnvFile(envPath);

  console.log("🐻 Starting bearclaw...\n");

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
    console.error("Run 'bearclaw init' first.");
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
  console.log("🐻 bearclaw status\n");
  console.log(`Project directory: ${CWD}\n`);

  const envPath = join(CWD, ".env");
  const hasEnv = existsSync(envPath);
  console.log(
    `Configuration:   ${hasEnv ? "✓ .env exists" : "✗ .env missing (run 'bearclaw init')"}`,
  );

  const hasContainerFiles = existsSync(join(CWD, "container/Dockerfile"));
  console.log(
    `Container files: ${hasContainerFiles ? "✓ present" : "✗ missing (run 'bearclaw init')"}`,
  );

  const imageCheck = spawnSync(
    "docker",
    ["image", "inspect", "bearclaw-agent:latest"],
    {
      stdio: "pipe",
    },
  );
  const hasImage = imageCheck.status === 0;
  console.log(
    `Container image: ${hasImage ? "✓ bearclaw-agent:latest" : "✗ not built (run 'bearclaw build')"}`,
  );

  if (hasEnv) {
    console.log("\nConfigured adapters:");
    const envContent = readFileSync(envPath, "utf-8");

    const hasWhatsApp = /BEARCLAW_ENABLE_WHATSAPP\s*=\s*true/i.test(envContent);
    const hasSlack = /^[^#]*SLACK_BOT_TOKEN=\S+/m.test(envContent);
    const hasDiscord = /^[^#]*DISCORD_BOT_TOKEN=\S+/m.test(envContent);

    console.log(`  WhatsApp: ${hasWhatsApp ? "✓ enabled" : "○ disabled"}`);
    console.log(
      `  Slack:    ${hasSlack ? "✓ configured" : "○ not configured"}`,
    );
    console.log(
      `  Discord:  ${hasDiscord ? "✓ configured" : "○ not configured"}`,
    );

    const portMatch = envContent.match(/BEARCLAW_CHATSDK_PORT\s*=\s*(\d+)/);
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
  .name("bearclaw")
  .description("Personal AI assistant for chat platforms")
  .version(getVersion());

program
  .command("init")
  .description("Initialize a new bearclaw project in current directory")
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
    let dataDir = ".bearclaw";

    if (existsSync(envPath)) {
      const envVars = loadEnvFile(envPath);
      if (envVars.BEARCLAW_DATA_DIR) {
        dataDir = envVars.BEARCLAW_DATA_DIR;
      }
    }

    const authDir =
      process.env.BEARCLAW_WHATSAPP_AUTH_DIR ||
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
