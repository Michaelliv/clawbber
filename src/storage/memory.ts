import fs from "node:fs";
import path from "node:path";

const PI_SUBDIRS = [".pi", ".pi/extensions", ".pi/skills", ".pi/prompts"];
const VAULT_DIRS = [".napkin", ".obsidian", "entities", "daily"];

/**
 * Ensure a pi resource directory exists with standard structure.
 * Used for global, main, and shared groups root.
 */
export function ensurePiResourceDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of PI_SUBDIRS) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  // Create empty AGENTS.md so pi discovers and loads from this directory
  const agentsPath = path.join(dir, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, "", "utf8");
  }
}

/**
 * Ensure vault structure exists in a workspace directory.
 * Creates .napkin/, .obsidian/, entities/, daily/ directories for napkin compatibility.
 */
export function ensureVaultStructure(dir: string): void {
  for (const sub of VAULT_DIRS) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
}

/**
 * Ensure a per-group workspace exists with the pi resource structure
 * and Obsidian-compatible vault structure.
 */
export function ensureGroupWorkspace(
  groupsDir: string,
  groupId: string,
): string {
  const safeGroup = groupId.replace(/[^a-zA-Z0-9-_]/g, "_");
  const dir = path.join(groupsDir, safeGroup);

  ensurePiResourceDir(dir);
  ensureVaultStructure(dir);

  return dir;
}
