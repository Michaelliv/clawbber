import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureGroupWorkspace } from "../src/storage/memory.js";

describe("ensureGroupWorkspace with vault structure", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mercury-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create vault directories", () => {
    const workspace = ensureGroupWorkspace(tempDir, "test-group");

    expect(existsSync(join(workspace, ".obsidian"))).toBe(true);
    expect(existsSync(join(workspace, "entities"))).toBe(true);
    expect(existsSync(join(workspace, "daily"))).toBe(true);
  });

  it("should create pi resource directories", () => {
    const workspace = ensureGroupWorkspace(tempDir, "test-group");

    expect(existsSync(join(workspace, ".pi"))).toBe(true);
    expect(existsSync(join(workspace, ".pi/extensions"))).toBe(true);
    expect(existsSync(join(workspace, ".pi/skills"))).toBe(true);
    expect(existsSync(join(workspace, ".pi/prompts"))).toBe(true);
  });

  it("should create AGENTS.md", () => {
    const workspace = ensureGroupWorkspace(tempDir, "test-group");

    expect(existsSync(join(workspace, "AGENTS.md"))).toBe(true);
  });

  it("should sanitize group id for directory name", () => {
    const workspace = ensureGroupWorkspace(tempDir, "test@group#123");

    expect(workspace).toBe(join(tempDir, "test_group_123"));
    expect(existsSync(workspace)).toBe(true);
  });

  it("should be idempotent", () => {
    const workspace1 = ensureGroupWorkspace(tempDir, "test-group");
    const workspace2 = ensureGroupWorkspace(tempDir, "test-group");

    expect(workspace1).toBe(workspace2);
    expect(existsSync(join(workspace1, ".obsidian"))).toBe(true);
  });
});
