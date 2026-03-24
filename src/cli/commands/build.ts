import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CWD, getImageTag, PACKAGE_ROOT } from "../helpers.js";

export async function buildAction(): Promise<void> {
  const baseDockerfile = join(PACKAGE_ROOT, "container/Dockerfile");
  const envPath = join(CWD, ".env");
  const tag = getImageTag(envPath);
  const extensionsDir = join(CWD, "extensions");

  let dockerfileContent = readFileSync(baseDockerfile, "utf8");

  if (existsSync(extensionsDir)) {
    const { ExtensionRegistry } = await import("../../extensions/loader.js");
    const { createDatabase } = await import("../../core/db.js");
    const { injectExtensionInstalls } = await import(
      "../../extensions/image-builder.js"
    );

    const { createExtensionStateService } = await import("../../extensions/state-service.js");
    const { createRoleService } = await import("../../services/roles/service.js");
    const { createConfigService } = await import("../../services/config/service.js");

    const tmpDbPath = join(CWD, "build-tmp.db");
    const db = createDatabase(tmpDbPath);
    const configSvc = createConfigService(db);
    const rolesSvc = createRoleService(db, configSvc);
    const extState = createExtensionStateService(db);
    const registry = new ExtensionRegistry();
    await registry.loadAll(extensionsDir, extState, rolesSvc, console as any);
    db.close();
    try {
      unlinkSync(tmpDbPath);
    } catch {}

    const extensions = registry.list();
    if (extensions.some((e) => e.clis.length > 0)) {
      const cliCount = extensions.reduce((n, e) => n + e.clis.length, 0);
      console.log(`Found ${cliCount} extension CLI(s):`);
      for (const ext of extensions) {
        for (const cli of ext.clis) {
          console.log(`  ${ext.name}: ${cli.install}`);
        }
      }
      dockerfileContent = injectExtensionInstalls(
        dockerfileContent,
        extensions,
      );
    }
  }

  const buildDir = join(CWD, ".build-context");
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, "Dockerfile"), dockerfileContent);

  console.log(`\n📦 Building ${tag}...\n`);
  const result = spawnSync(
    "docker",
    ["build", "-f", join(buildDir, "Dockerfile"), "-t", tag, PACKAGE_ROOT],
    { stdio: "inherit", timeout: 600_000 },
  );

  rmSync(buildDir, { recursive: true, force: true });

  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`\n✓ Built ${tag}`);
}
