#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
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
CLAWBBER_CHATSDK_USERNAME=clawbber
CLAWBBER_CHATSDK_PORT=3000
CLAWBBER_TRIGGER_PATTERNS=@Clawbber,Clawbber

# Model
CLAWBBER_MODEL_PROVIDER=anthropic
CLAWBBER_MODEL=claude-sonnet-4-20250514

# Runtime
CLAWBBER_DATA_DIR=.clawbber
CLAWBBER_MAX_CONCURRENCY=2
CLAWBBER_LOG_LEVEL=info

# Containerized agent runtime
CLAWBBER_AGENT_CONTAINER_IMAGE=clawbber-agent:latest

# Optional: admin caller IDs (comma-separated)
# CLAWBBER_ADMINS=

# WhatsApp ingress (Baileys socket)
CLAWBBER_ENABLE_WHATSAPP=false

# Optional Slack ingress
# SLACK_BOT_TOKEN=
# SLACK_SIGNING_SECRET=

# Optional Discord ingress
# DISCORD_BOT_TOKEN=
# DISCORD_PUBLIC_KEY=
# DISCORD_APPLICATION_ID=
`;

const DOCKERFILE_TEMPLATE = `# Clawbber Agent Container
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
COPY src/cli/clawbber-ctl.ts /app/src/cli/clawbber-ctl.ts
COPY src/types.ts /app/src/types.ts

ENTRYPOINT ["bun", "run", "/app/src/agent/container-entry.ts"]
`;

const BUILD_SCRIPT_TEMPLATE = `#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

IMAGE_NAME="clawbber-agent"
TAG="\${1:-latest}"

echo "Building Clawbber agent container image..."
echo "Image: \${IMAGE_NAME}:\${TAG}"

docker build -f container/Dockerfile -t "\${IMAGE_NAME}:\${TAG}" .

echo ""
echo "Build complete: \${IMAGE_NAME}:\${TAG}"
`;

const AGENTS_MD_TEMPLATE = `# Clawbber Agent Instructions

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
  console.log("🦞 Initializing clawbber project...\n");

  // Create .env if it doesn't exist
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, ENV_TEMPLATE);
    console.log("  ✓ .env");
  } else {
    console.log("  • .env (already exists)");
  }

  // Create data directories
  const dirs = [".clawbber", ".clawbber/groups", ".clawbber/global"];
  for (const dir of dirs) {
    const fullPath = join(CWD, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      console.log(`  ✓ ${dir}/`);
    }
  }

  // Create AGENTS.md for the agent
  const agentsMdPath = join(CWD, ".clawbber/global/AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    writeFileSync(agentsMdPath, AGENTS_MD_TEMPLATE);
    console.log("  ✓ .clawbber/global/AGENTS.md");
  } else {
    console.log("  • .clawbber/global/AGENTS.md (already exists)");
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
  copySourceFile("src/cli/clawbber-ctl.ts", "src/cli/clawbber-ctl.ts");
  copySourceFile("src/types.ts", "src/types.ts");

  // Build container
  console.log("\n📦 Building container image...\n");
  const buildResult = spawnSync("bash", [buildScriptPath], {
    stdio: "inherit",
    cwd: CWD,
  });

  if (buildResult.status !== 0) {
    console.error(
      "\n⚠️  Container build failed. You can retry with 'clawbber build'",
    );
  }

  console.log("\n🦞 Initialization complete!");
  console.log("\nNext steps:");
  console.log("  1. Edit .env to set your API keys and enable adapters");
  console.log("  2. Run 'clawbber run' to start");
}

async function runAction(): Promise<void> {
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    console.error("Error: .env file not found in current directory.");
    console.error(
      "Run 'clawbber init' first, or cd into your clawbber project.",
    );
    process.exit(1);
  }

  const imageCheck = spawnSync(
    "docker",
    ["image", "inspect", "clawbber-agent:latest"],
    {
      stdio: "pipe",
    },
  );
  if (imageCheck.status !== 0) {
    console.error("Error: Container image 'clawbber-agent:latest' not found.");
    console.error("Run 'clawbber build' to build it.");
    process.exit(1);
  }

  const envVars = loadEnvFile(envPath);

  console.log("🦞 Starting clawbber...\n");

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
    console.error("Run 'clawbber init' first.");
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
  console.log("🦞 clawbber status\n");
  console.log(`Project directory: ${CWD}\n`);

  const envPath = join(CWD, ".env");
  const hasEnv = existsSync(envPath);
  console.log(
    `Configuration:   ${hasEnv ? "✓ .env exists" : "✗ .env missing (run 'clawbber init')"}`,
  );

  const hasContainerFiles = existsSync(join(CWD, "container/Dockerfile"));
  console.log(
    `Container files: ${hasContainerFiles ? "✓ present" : "✗ missing (run 'clawbber init')"}`,
  );

  const imageCheck = spawnSync(
    "docker",
    ["image", "inspect", "clawbber-agent:latest"],
    {
      stdio: "pipe",
    },
  );
  const hasImage = imageCheck.status === 0;
  console.log(
    `Container image: ${hasImage ? "✓ clawbber-agent:latest" : "✗ not built (run 'clawbber build')"}`,
  );

  if (hasEnv) {
    console.log("\nConfigured adapters:");
    const envContent = readFileSync(envPath, "utf-8");

    const hasWhatsApp = /CLAWBBER_ENABLE_WHATSAPP\s*=\s*true/i.test(envContent);
    const hasSlack = /^[^#]*SLACK_BOT_TOKEN=\S+/m.test(envContent);
    const hasDiscord = /^[^#]*DISCORD_BOT_TOKEN=\S+/m.test(envContent);

    console.log(`  WhatsApp: ${hasWhatsApp ? "✓ enabled" : "○ disabled"}`);
    console.log(
      `  Slack:    ${hasSlack ? "✓ configured" : "○ not configured"}`,
    );
    console.log(
      `  Discord:  ${hasDiscord ? "✓ configured" : "○ not configured"}`,
    );

    const portMatch = envContent.match(/CLAWBBER_CHATSDK_PORT\s*=\s*(\d+)/);
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
  .name("clawbber")
  .description("Personal AI assistant for chat platforms")
  .version(getVersion());

program
  .command("init")
  .description("Initialize a new clawbber project in current directory")
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
    let dataDir = ".clawbber";

    if (existsSync(envPath)) {
      const envVars = loadEnvFile(envPath);
      if (envVars.CLAWBBER_DATA_DIR) {
        dataDir = envVars.CLAWBBER_DATA_DIR;
      }
    }

    const authDir =
      process.env.CLAWBBER_WHATSAPP_AUTH_DIR ||
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
