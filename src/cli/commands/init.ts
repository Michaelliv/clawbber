import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CWD, PACKAGE_ROOT, TEMPLATES_DIR } from "../helpers.js";
import { createDatabase } from "../../core/db.js";
import { createApiKeyService } from "../../services/api-keys/service.js";

export function initAction(): void {
  console.log("🪽 Initializing mercury project...\n");

  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    copyFileSync(join(TEMPLATES_DIR, "env.template"), envPath);
    console.log("  ✓ .env");
  } else {
    console.log("  • .env (already exists)");
  }

  const wsDir = join(CWD, "workspace");
  mkdirSync(wsDir, { recursive: true });
  console.log("  ✓ workspace/");

  const agentsMdPath = join(wsDir, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    copyFileSync(join(TEMPLATES_DIR, "AGENTS.md"), agentsMdPath);
    console.log("  ✓ workspace/AGENTS.md");
  } else {
    console.log("  • workspace/AGENTS.md (already exists)");
  }

  const srcExtDir = join(PACKAGE_ROOT, "resources/extensions/subagent");
  if (existsSync(srcExtDir)) {
    console.log("\nCopying subagent extension:");
    const extensionsDir = join(wsDir, ".pi/extensions/subagent");
    mkdirSync(extensionsDir, { recursive: true });
    for (const file of readdirSync(srcExtDir)) {
      copyFileSync(join(srcExtDir, file), join(extensionsDir, file));
      console.log(`  ✓ .pi/extensions/subagent/${file}`);
    }
  }

  // Generate first API key
  const dbPath = join(CWD, "state.db");
  const db = createDatabase(dbPath);
  const apiKeys = createApiKeyService(db);
  const existing = apiKeys.list();
  if (existing.length === 0) {
    const { key } = apiKeys.create("default");
    console.log(`\n  ✓ API key generated`);
    console.log(`    Key: ${key}`);
    console.log(`    Save this — it won't be shown again.`);
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("PRAGMA journal_mode = DELETE");
  db.close();

  console.log("\n🪽 Initialization complete!");
  console.log("\nNext steps:");
  console.log("  1. Edit .env to set your API keys and enable adapters");
  console.log("  2. Run 'mercury start' to start the service");
}
