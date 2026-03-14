/**
 * Derived image builder.
 *
 * When extensions declare CLI tools via `mercury.cli()`, this module
 * generates a Dockerfile extending the base agent image with those
 * CLIs installed, builds it, and caches the result by content hash.
 *
 * Install commands are grouped by package manager (apt, pip, npm, bun)
 * into minimal RUN steps with BuildKit cache mounts for fast rebuilds.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "../logger.js";
import type { ExtensionMeta } from "./types.js";

/** Parsed install command — either a known package manager or raw shell. */
export type ParsedInstall =
  | { type: "apt"; packages: string[] }
  | { type: "pip"; packages: string[] }
  | { type: "npm"; packages: string[] }
  | { type: "bun"; packages: string[] }
  | { type: "shell"; command: string };

/**
 * Split a command string on `&&` while respecting single and double quotes.
 * `&&` inside quoted strings is not treated as a separator.
 */
function splitOnAnd(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "&" && cmd[i + 1] === "&" && !inSingle && !inDouble) {
      parts.push(current.trim());
      current = "";
      i++; // skip second &
    } else {
      current += ch;
    }
  }

  const last = current.trim();
  if (last) parts.push(last);

  return parts;
}

/**
 * Parse a single install command string into a typed representation.
 * Recognizes apt-get, pip, npm, and bun patterns. Falls back to shell.
 */
export function parseInstallCommand(cmd: string): ParsedInstall[] {
  const results: ParsedInstall[] = [];

  // Split on && respecting quotes
  const parts = splitOnAnd(cmd);

  for (const part of parts) {
    // apt-get install
    const aptMatch = part.match(
      /^apt-get\s+(?:update\s*$|install\s+(?:-\S+\s+)*(.+))/,
    );
    if (aptMatch) {
      if (aptMatch[1]) {
        // Extract package names (skip flags like -y --no-install-recommends)
        const packages = aptMatch[1]
          .split(/\s+/)
          .filter((s) => s && !s.startsWith("-"));
        if (packages.length > 0) {
          results.push({ type: "apt", packages });
        }
      }
      // Skip bare "apt-get update" and "rm -rf /var/lib/apt/lists/*"
      continue;
    }

    // rm -rf /var/lib/apt/lists/* (apt cleanup, skip)
    if (/^rm\s+-rf\s+\/var\/lib\/apt\/lists/.test(part)) {
      continue;
    }

    // pip install
    const pipMatch = part.match(
      /^(?:python3\s+-m\s+)?pip\s+install\s+(?:-\S+\s+)*(.+)/,
    );
    if (pipMatch) {
      const packages = pipMatch[1]
        .split(/\s+/)
        .filter((s) => s && !s.startsWith("-"));
      if (packages.length > 0) {
        results.push({ type: "pip", packages });
      }
      continue;
    }

    // npm install -g
    const npmMatch = part.match(/^npm\s+install\s+-g\s+(.+)/);
    if (npmMatch) {
      const packages = npmMatch[1]
        .split(/\s+/)
        .filter((s) => s && !s.startsWith("-"));
      if (packages.length > 0) {
        results.push({ type: "npm", packages });
      }
      continue;
    }

    // bun add -g
    const bunMatch = part.match(/^bun\s+add\s+-g\s+(.+)/);
    if (bunMatch) {
      const packages = bunMatch[1]
        .split(/\s+/)
        .filter((s) => s && !s.startsWith("-"));
      if (packages.length > 0) {
        results.push({ type: "bun", packages });
      }
      continue;
    }

    // Everything else is a shell command
    if (part) {
      results.push({ type: "shell", command: part });
    }
  }

  return results;
}

/**
 * Merge parsed install commands: group packages by manager, deduplicate.
 * Shell commands are preserved in order.
 */
export function mergeInstalls(parsed: ParsedInstall[]): ParsedInstall[] {
  const apt = new Set<string>();
  const pip = new Set<string>();
  const npm = new Set<string>();
  const bun = new Set<string>();
  const shell: string[] = [];
  const shellSeen = new Set<string>();

  for (const p of parsed) {
    if (p.type === "shell") {
      if (!shellSeen.has(p.command)) {
        shellSeen.add(p.command);
        shell.push(p.command);
      }
    } else {
      const set =
        p.type === "apt"
          ? apt
          : p.type === "pip"
            ? pip
            : p.type === "npm"
              ? npm
              : bun;
      for (const pkg of p.packages) set.add(pkg);
    }
  }

  const result: ParsedInstall[] = [];
  if (apt.size > 0) result.push({ type: "apt", packages: [...apt].sort() });
  if (pip.size > 0) result.push({ type: "pip", packages: [...pip].sort() });
  if (npm.size > 0) result.push({ type: "npm", packages: [...npm].sort() });
  if (bun.size > 0) result.push({ type: "bun", packages: [...bun].sort() });
  for (const cmd of shell) result.push({ type: "shell", command: cmd });

  return result;
}

/**
 * Convert merged installs into RUN lines with BuildKit cache mounts.
 */
export function toRunStatements(merged: ParsedInstall[]): string[] {
  const lines: string[] = [];

  for (const m of merged) {
    switch (m.type) {
      case "apt":
        lines.push(
          `RUN apt-get update && apt-get install -y --no-install-recommends ${m.packages.join(" ")} && ` +
            `rm -rf /var/lib/apt/lists/*`,
        );
        break;
      case "pip":
        lines.push(
          `RUN --mount=type=cache,target=/root/.cache/pip ` +
            `pip install --break-system-packages ${m.packages.join(" ")}`,
        );
        break;
      case "npm":
        lines.push(
          `RUN --mount=type=cache,target=/root/.npm ` +
            `npm install -g ${m.packages.join(" ")}`,
        );
        break;
      case "bun":
        lines.push(
          `RUN --mount=type=cache,target=/root/.bun/install/cache ` +
            `bun add -g ${m.packages.join(" ")}`,
        );
        break;
      case "shell":
        lines.push(`RUN ${m.command}`);
        break;
    }
  }

  return lines;
}

/**
 * Generate a Dockerfile that extends the base image with extension CLI installs.
 * Returns null if no extensions declare CLIs.
 *
 * Install commands are parsed, merged by package manager, deduplicated,
 * and emitted as minimal RUN steps with BuildKit cache mounts.
 */
export function generateDockerfile(
  baseImage: string,
  extensions: ExtensionMeta[],
): string | null {
  const allClis = extensions.flatMap((e) => e.clis);
  if (allClis.length === 0) return null;

  // Parse all install commands
  const parsed = allClis.flatMap((cli) => parseInstallCommand(cli.install));

  // Merge by package manager
  const merged = mergeInstalls(parsed);

  // Generate Dockerfile
  const lines = [`# syntax=docker/dockerfile:1`, `FROM ${baseImage}`];
  lines.push(...toRunStatements(merged));

  return lines.join("\n");
}

/**
 * Compute a deterministic hash for cache invalidation.
 * Based on the base image name and sorted install commands.
 */
export function computeImageHash(
  baseImage: string,
  extensions: ExtensionMeta[],
): string {
  const installCommands = extensions
    .flatMap((e) => e.clis)
    .map((c) => c.install)
    .sort()
    .join("\n");

  return createHash("sha256")
    .update(`${baseImage}\n${installCommands}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Check if a Docker image exists locally.
 */
function imageExists(tag: string): boolean {
  try {
    execSync(`docker image inspect ${tag}`, {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the derived image if needed. Returns the image name to use.
 *
 * - If no extensions declare CLIs, returns the base image unchanged.
 * - If a cached image exists (same hash), returns it.
 * - Otherwise builds a new image and returns its tag.
 * - On build failure, falls back to the base image with a warning.
 */
export async function ensureDerivedImage(
  baseImage: string,
  extensions: ExtensionMeta[],
  log: Logger,
): Promise<string> {
  const dockerfile = generateDockerfile(baseImage, extensions);
  if (!dockerfile) {
    log.debug("No extension CLIs declared, using base image");
    return baseImage;
  }

  const cliCount = extensions.reduce((n, e) => n + e.clis.length, 0);
  const hash = computeImageHash(baseImage, extensions);
  const derivedTag = `mercury-agent-ext:${hash}`;

  // Check cache
  if (imageExists(derivedTag)) {
    log.info(`Using cached agent image ${derivedTag}`);
    return derivedTag;
  }

  // Build
  log.info(
    `Building derived agent image (${cliCount} extension CLI${cliCount > 1 ? "s" : ""})...`,
  );
  for (const ext of extensions) {
    for (const cli of ext.clis) {
      log.info(`  ${ext.name}: ${cli.install}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-ext-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), dockerfile);
    log.debug("Generated Dockerfile:\n" + dockerfile);

    const startTime = Date.now();
    execSync(`DOCKER_BUILDKIT=1 docker build -t ${derivedTag} ${tmpDir}`, {
      encoding: "utf8",
      timeout: 600_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const durationMs = Date.now() - startTime;

    log.info(`Built derived agent image ${derivedTag}`, { durationMs });
    return derivedTag;
  } catch (err: unknown) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: unknown }).stderr).slice(-2000)
        : "";
    const msg = err instanceof Error ? err.message : String(err);
    log.error(
      `Failed to build derived image, falling back to base image: ${msg}`,
    );
    if (stderr) {
      log.error(`Docker build stderr:\n${stderr}`);
    }
    return baseImage;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
