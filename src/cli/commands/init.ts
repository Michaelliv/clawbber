import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CWD, PACKAGE_ROOT, TEMPLATES_DIR } from "../helpers.js";
import { createDatabase } from "../../core/db.js";
import { createApiKeyService } from "../../services/api-keys/service.js";

const GITIGNORE = `.env
state.db
state.db-shm
state.db-wal
whatsapp-auth/
pi-agent/
sessions/
workspace/outbox/
workspace/inbox/
workspace/auth.json
workspace/.messages/
workspace/.pi/skills/
workspace/.pi/extensions/
extensions/*/dist/
extensions/*/node_modules/
.build-context/
build-tmp.db
build-tmp.db-shm
build-tmp.db-wal
`;

const CI_WORKFLOW = `name: Build

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-24.04-arm
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Lowercase repo name
        id: lower
        run: echo "repo=\${GITHUB_REPOSITORY,,}" >> \$GITHUB_OUTPUT

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/\${{ steps.lower.outputs.repo }}:latest
            ghcr.io/\${{ steps.lower.outputs.repo }}:\${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;

export function initAction(): void {
  console.log("🪽 Initializing mercury project...\n");

  const envExamplePath = join(CWD, ".env.example");
  if (!existsSync(envExamplePath)) {
    copyFileSync(join(TEMPLATES_DIR, "env.template"), envExamplePath);
    console.log("  ✓ .env.example");
  } else {
    console.log("  • .env.example (already exists)");
  }

  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    copyFileSync(envExamplePath, envPath);
    console.log("  ✓ .env (copied from .env.example — edit this)");
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

  const gitignorePath = join(CWD, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE);
    console.log("  ✓ .gitignore");
  } else {
    console.log("  • .gitignore (already exists)");
  }

  const ciDir = join(CWD, ".github", "workflows");
  const ciPath = join(ciDir, "build.yml");
  if (!existsSync(ciPath)) {
    mkdirSync(ciDir, { recursive: true });
    writeFileSync(ciPath, CI_WORKFLOW);
    console.log("  ✓ .github/workflows/build.yml");
  } else {
    console.log("  • .github/workflows/build.yml (already exists)");
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
  console.log("  1. Edit .env with your API keys and adapter settings");
  console.log("  2. mercury ext add <source>   — install extensions");
  console.log("  3. mercury dockerfile          — generate Dockerfile");
  console.log("  4. mercury build               — build image locally");
}
