import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "../../core/db.js";
import { CWD, getProjectDataDir, loadEnvFile } from "../helpers.js";

export function doctorAction(): void {
  console.log("🩺 mercury doctor\n");

  let passed = 0;
  let warned = 0;
  let failed = 0;

  function pass(msg: string): void {
    console.log(`  ✅ ${msg}`);
    passed++;
  }
  function warn(msg: string, fix?: string): void {
    console.log(`  ⚠️  ${msg}`);
    if (fix) console.log(`     → ${fix}`);
    warned++;
  }
  function fail(msg: string, fix?: string): void {
    console.log(`  ❌ ${msg}`);
    if (fix) console.log(`     → ${fix}`);
    failed++;
  }

  console.log("Configuration:");
  const envPath = join(CWD, ".env");
  const hasEnv = existsSync(envPath);
  if (hasEnv) {
    pass(".env file found");
  } else {
    fail(".env file missing", "Run 'mercury init' to create one");
  }

  const envVars = hasEnv ? loadEnvFile(envPath) : {};

  console.log("\nAgent:");
  const piCheck = spawnSync("which", ["pi"], { stdio: "pipe" });
  if (piCheck.status === 0) {
    pass("pi CLI found");
  } else {
    fail("pi CLI not found", "Install from https://github.com/badlogic/pi");
  }

  console.log("\nAI Credentials:");
  const dataDir = getProjectDataDir();
  const authPath = join(CWD, dataDir, "pi-agent", "auth.json");
  const hasOAuth = existsSync(authPath);
  const hasApiKey = !!(
    envVars.MERCURY_ANTHROPIC_API_KEY || envVars.MERCURY_ANTHROPIC_OAUTH_TOKEN
  );
  if (hasOAuth || hasApiKey) {
    if (hasOAuth) pass("OAuth credentials found (auth.json)");
    if (hasApiKey) pass("API key found in .env");
  } else {
    fail(
      "No AI credentials configured",
      "Run 'mercury auth login' or set MERCURY_ANTHROPIC_API_KEY in .env",
    );
  }

  console.log("\nAdapters:");
  const whatsappEnabled =
    envVars.MERCURY_ENABLE_WHATSAPP?.toLowerCase() === "true";
  const discordEnabled =
    envVars.MERCURY_ENABLE_DISCORD?.toLowerCase() === "true";
  const slackEnabled = envVars.MERCURY_ENABLE_SLACK?.toLowerCase() === "true";

  if (!whatsappEnabled && !discordEnabled && !slackEnabled) {
    fail(
      "No adapters enabled",
      "Set MERCURY_ENABLE_WHATSAPP, MERCURY_ENABLE_DISCORD, or MERCURY_ENABLE_SLACK to true in .env",
    );
  } else {
    if (whatsappEnabled) {
      const whatsappAuthDir =
        envVars.MERCURY_WHATSAPP_AUTH_DIR ||
        join(CWD, dataDir, "whatsapp-auth");
      const credsFile = join(whatsappAuthDir, "creds.json");
      if (existsSync(credsFile)) {
        pass("WhatsApp: enabled and authenticated");
      } else {
        fail(
          "WhatsApp: enabled but not authenticated",
          "Run 'mercury auth whatsapp' first",
        );
      }
    }
    if (discordEnabled) {
      if (envVars.MERCURY_DISCORD_BOT_TOKEN) {
        pass("Discord: enabled and token configured");
      } else {
        fail(
          "Discord: enabled but MERCURY_DISCORD_BOT_TOKEN not set",
          "Add your bot token to .env",
        );
      }
    }
    if (slackEnabled) {
      const hasToken = !!envVars.MERCURY_SLACK_BOT_TOKEN;
      const hasSecret = !!envVars.MERCURY_SLACK_SIGNING_SECRET;
      if (hasToken && hasSecret) {
        pass("Slack: enabled and configured");
      } else {
        const missing = [
          !hasToken && "MERCURY_SLACK_BOT_TOKEN",
          !hasSecret && "MERCURY_SLACK_SIGNING_SECRET",
        ].filter(Boolean);
        fail(`Slack: enabled but missing ${missing.join(", ")}`, "Add to .env");
      }
    }
  }

  console.log("\nPermissions:");
  pass("Admin access via DM pairing — run 'mercury pair' then DM /pair <code>");

  console.log("\nNetwork:");
  const port = envVars.MERCURY_PORT || "3000";
  const portCheck = spawnSync("lsof", ["-i", `:${port}`, "-t"], {
    stdio: "pipe",
  });
  const portInUse =
    portCheck.status === 0 && portCheck.stdout.toString().trim().length > 0;
  if (portInUse) {
    warn(
      `Port ${port} is in use (Mercury may already be running)`,
      "Change MERCURY_PORT in .env or stop the existing process",
    );
  } else {
    pass(`Port ${port} is available`);
  }

  console.log("\nDatabase:");
  const dbPath = join(CWD, dataDir, "state.db");
  if (existsSync(dbPath)) {
    try {
      const db = createDatabase(dbPath);
      pass("Database accessible");
      db.close();
    } catch {
      warn("Could not read database");
    }
  } else {
    warn("No database yet (created on first run)");
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`  ${passed} passed  ${warned} warnings  ${failed} errors`);
  if (failed > 0) {
    console.log("\n  Fix the errors above before starting Mercury.");
    process.exit(1);
  } else if (warned > 0) {
    console.log("\n  Mercury should work, but review the warnings above.");
  } else {
    console.log("\n  Everything looks good! 🚀");
  }
}
