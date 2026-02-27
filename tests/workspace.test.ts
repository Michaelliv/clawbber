import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureGroupWorkspace,
  ensurePiResourceDir,
} from "../src/storage/memory.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensurePiResourceDir", () => {
  test("creates directory with .pi subdirs and empty AGENTS.md", () => {
    const dir = path.join(tmpDir, "global");
    ensurePiResourceDir(dir);

    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/extensions"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/skills"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/prompts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("");
  });

  test("does not overwrite existing AGENTS.md", () => {
    const dir = path.join(tmpDir, "global");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "custom content");

    ensurePiResourceDir(dir);

    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe(
      "custom content",
    );
  });

  test("is idempotent", () => {
    const dir = path.join(tmpDir, "global");
    ensurePiResourceDir(dir);
    ensurePiResourceDir(dir);

    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/extensions"))).toBe(true);
  });
});

describe("ensureGroupWorkspace", () => {
  test("creates group workspace with sanitized name", () => {
    const groupsDir = path.join(tmpDir, "groups");
    fs.mkdirSync(groupsDir, { recursive: true });

    const dir = ensureGroupWorkspace(groupsDir, "whatsapp:123@s.whatsapp.net");

    expect(dir).toBe(path.join(groupsDir, "whatsapp_123_s_whatsapp_net"));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/extensions"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/skills"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/prompts"))).toBe(true);
  });

  test("sanitizes special characters in group ID", () => {
    const groupsDir = path.join(tmpDir, "groups");
    fs.mkdirSync(groupsDir, { recursive: true });

    const dir = ensureGroupWorkspace(groupsDir, "slack:C08ABC/DEF");
    expect(path.basename(dir)).toBe("slack_C08ABC_DEF");
  });

  test("preserves safe characters", () => {
    const groupsDir = path.join(tmpDir, "groups");
    fs.mkdirSync(groupsDir, { recursive: true });

    const dir = ensureGroupWorkspace(groupsDir, "main");
    expect(path.basename(dir)).toBe("main");
  });

  test("does not overwrite existing group workspace", () => {
    const groupsDir = path.join(tmpDir, "groups");
    fs.mkdirSync(groupsDir, { recursive: true });

    const dir = ensureGroupWorkspace(groupsDir, "test-group");
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "group instructions");

    const dir2 = ensureGroupWorkspace(groupsDir, "test-group");
    expect(dir2).toBe(dir);
    expect(fs.readFileSync(path.join(dir2, "AGENTS.md"), "utf8")).toBe(
      "group instructions",
    );
  });
});

describe("full workspace structure", () => {
  test("scaffolds global + groups + main correctly", () => {
    const dataDir = path.join(tmpDir, ".mercury");
    const globalDir = path.join(dataDir, "global");
    const groupsDir = path.join(dataDir, "groups");

    ensurePiResourceDir(globalDir);
    ensureGroupWorkspace(groupsDir, "main");

    // Global
    expect(fs.existsSync(path.join(globalDir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(globalDir, ".pi/extensions"))).toBe(true);
    expect(fs.existsSync(path.join(globalDir, ".pi/skills"))).toBe(true);

    // Main
    expect(fs.existsSync(path.join(groupsDir, "main/AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(groupsDir, "main/.pi/extensions"))).toBe(
      true,
    );

    // Groups root has no AGENTS.md (not scaffolded)
    expect(fs.existsSync(path.join(groupsDir, "AGENTS.md"))).toBe(false);
  });

  test("adding a new group creates its workspace", () => {
    const groupsDir = path.join(tmpDir, "groups");

    const dir = ensureGroupWorkspace(groupsDir, "new-chat");

    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/extensions"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/skills"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".pi/prompts"))).toBe(true);
  });
});
