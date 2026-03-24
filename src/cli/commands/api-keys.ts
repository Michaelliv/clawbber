import type { Command } from "commander";
import { createDatabase } from "../../core/db.js";
import { createApiKeyService } from "../../services/api-keys/service.js";
import { join } from "node:path";
import { CWD, getProjectRoot } from "../helpers.js";

function withApiKeys<T>(fn: (svc: ReturnType<typeof createApiKeyService>) => T): T {
  const dbPath = join(CWD, getProjectRoot(), "state.db");
  const db = createDatabase(dbPath);
  db.exec("PRAGMA journal_mode = DELETE");
  try {
    return fn(createApiKeyService(db));
  } finally {
    db.close();
  }
}

export function registerApiKeyCommands(cmd: Command): void {
  cmd
    .command("create <name>")
    .description("Create a new API key")
    .action((name: string) => {
      const result = withApiKeys((svc) => svc.create(name));
      console.log(`\n  API Key created: ${result.info.name}`);
      console.log(`  Key: ${result.key}`);
      console.log(`\n  Save this key — it won't be shown again.\n`);
    });

  cmd
    .command("list")
    .description("List all API keys")
    .action(() => {
      const keys = withApiKeys((svc) => svc.list());
      if (keys.length === 0) {
        console.log("No API keys found.");
        return;
      }
      for (const k of keys) {
        const status = k.revokedAt ? "revoked" : "active";
        const date = new Date(k.createdAt).toISOString().split("T")[0];
        console.log(`${k.id}\t${k.keyPrefix}...\t${status}\t${date}\t${k.name}`);
      }
    });

  cmd
    .command("revoke <id>")
    .description("Revoke an API key")
    .action((id: string) => {
      const keyId = Number.parseInt(id, 10);
      if (!Number.isFinite(keyId)) {
        console.error("Error: invalid key ID");
        process.exit(1);
      }
      const ok = withApiKeys((svc) => svc.revoke(keyId));
      if (ok) console.log(`Revoked API key ${keyId}`);
      else {
        console.error("Error: key not found or already revoked");
        process.exit(1);
      }
    });
}
