/**
 * Extension discovery, loading, and registry.
 *
 * Scans `extensions/` for directories with index.ts,
 * loads them, validates, and builds a registry.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../core/logger.js";
import type { ExtensionStateService } from "./state-service.js";
import type { RoleService } from "../services/roles/interface.js";
import { MercuryExtensionAPIImpl } from "./api.js";
import type { ConfigRegistry } from "../services/config/registry.js";
import { RESERVED_EXTENSION_NAMES } from "./reserved.js";
import type {
  EventHandler,
  ExtensionMeta,
  JobDef,
  MercuryEvents,
} from "./types.js";

/** Extension names must be alphanumeric + hyphens. */
const VALID_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export class ExtensionRegistry {
  private readonly extensions = new Map<string, ExtensionMeta>();

  /**
   * Load all extensions from one or more directories.
   * The first directory is the primary (user extensions),
   * additional directories are for built-in extensions shipped with Mercury.
   */
  async loadAll(
    extensionsDir: string,
    extState: ExtensionStateService,
    roles: RoleService,
    log: Logger,
    configRegistry?: ConfigRegistry,
    ...extraDirs: string[]
  ): Promise<void> {
    const dirs = [extensionsDir, ...extraDirs];
    for (const dir of dirs) {
      await this.loadFromDir(dir, extState, roles, log, configRegistry);
    }
  }

  private async loadFromDir(
    extensionsDir: string,
    extState: ExtensionStateService,
    roles: RoleService,
    log: Logger,
    configRegistry?: ConfigRegistry,
  ): Promise<void> {
    if (!fs.existsSync(extensionsDir)) {
      log.debug(`Extensions directory not found: ${extensionsDir}`);
      return;
    }

    const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      const extDir = path.join(extensionsDir, name);

      // Validate name format
      if (!VALID_NAME_RE.test(name)) {
        log.warn(
          `Skipping extension "${name}": invalid name (must be lowercase alphanumeric + hyphens)`,
        );
        continue;
      }

      // Check reserved names
      if (RESERVED_EXTENSION_NAMES.has(name)) {
        throw new Error(`Extension "${name}" conflicts with built-in command`);
      }

      // Check for index.ts
      const indexPath = path.join(extDir, "index.ts");
      if (!fs.existsSync(indexPath)) {
        log.warn(
          `Skipping extension "${name}": no index.ts found in ${extDir}`,
        );
        continue;
      }

      // Check duplicate
      if (this.extensions.has(name)) {
        throw new Error(`Duplicate extension name: "${name}"`);
      }

      try {
        const meta = await loadExtension(name, extDir, indexPath, extState, roles);
        // Register extension config keys in the config registry
        if (configRegistry) {
          for (const [key, def] of meta.configs) {
            configRegistry.register(name, key, def);
          }
        }
        this.extensions.set(name, meta);
        log.info(`Loaded extension: ${name}`);
      } catch (err) {
        log.error(
          `Failed to load extension "${name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Get an extension by name. */
  get(name: string): ExtensionMeta | undefined {
    return this.extensions.get(name);
  }

  /** List all loaded extensions. */
  list(): ExtensionMeta[] {
    return [...this.extensions.values()];
  }

  /** Get extensions that declare a CLI. */
  getCliExtensions(): ExtensionMeta[] {
    return this.list().filter((ext) => ext.clis.length > 0);
  }

  /** Get all env var source names claimed by extensions (for passthrough filtering). */
  getClaimedEnvSources(): Set<string> {
    const sources = new Set<string>();
    for (const ext of this.extensions.values()) {
      for (const envDef of ext.envVars) {
        sources.add(envDef.from);
      }
    }
    return sources;
  }

  /** Get all hook handlers for a specific event, across all extensions. */
  getHookHandlers<E extends keyof MercuryEvents>(event: E): EventHandler<E>[] {
    const handlers: EventHandler<E>[] = [];
    for (const ext of this.extensions.values()) {
      const extHandlers = ext.hooks.get(event);
      if (extHandlers) {
        handlers.push(...(extHandlers as EventHandler<E>[]));
      }
    }
    return handlers;
  }

  /** Get all jobs across all extensions. */
  getJobs(): Array<{ extension: string; name: string; def: JobDef }> {
    const jobs: Array<{ extension: string; name: string; def: JobDef }> = [];
    for (const ext of this.extensions.values()) {
      for (const [name, def] of ext.jobs) {
        jobs.push({ extension: ext.name, name, def });
      }
    }
    return jobs;
  }

  /** Number of loaded extensions. */
  get size(): number {
    return this.extensions.size;
  }
}

/**
 * Load a single extension: import its index.ts, run the setup function,
 * and return the collected metadata.
 */
async function loadExtension(
  name: string,
  extDir: string,
  indexPath: string,
  extState: ExtensionStateService,
  roles: RoleService,
): Promise<ExtensionMeta> {
  const mod = await import(indexPath);
  const setup = mod.default;

  if (typeof setup !== "function") {
    throw new Error(
      `Extension "${name}": index.ts must export a default function`,
    );
  }

  const api = new MercuryExtensionAPIImpl(
    name,
    extDir,
    extState,
    (permName, opts) => roles.registerPermission(permName, opts),
  );
  setup(api);
  return api.getMeta();
}
