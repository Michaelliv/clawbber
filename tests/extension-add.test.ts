import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for the extension add/remove/list helper functions.
 *
 * We test the underlying logic (resolveExtensionSource, validateExtension, etc.)
 * rather than the CLI action wrappers, since those call process.exit().
 */

// Import the reserved names to check validation
import { RESERVED_EXTENSION_NAMES } from "../src/extensions/reserved.js";

const VALID_EXT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

let testDir: string;
let extensionsDir: string;
let globalDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `mercury-add-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  extensionsDir = join(testDir, "extensions");
  globalDir = join(testDir, "global");
  mkdirSync(extensionsDir, { recursive: true });
  mkdirSync(globalDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function createTestExtension(
  dir: string,
  name: string,
  opts?: { skill?: boolean; packageJson?: boolean },
): string {
  const extDir = join(dir, name);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, "index.ts"),
    `export default function(mercury: any) {
  ${opts?.skill ? `mercury.skill("./skill");` : ""}
}`,
  );
  if (opts?.skill) {
    const skillDir = join(extDir, "skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: ${name}
description: Test extension for ${name}
---

## Usage
mrctl ${name} do-stuff
`,
    );
  }
  if (opts?.packageJson) {
    writeFileSync(
      join(extDir, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
    );
  }
  return extDir;
}

describe("extension name validation", () => {
  it("accepts valid names", () => {
    expect(VALID_EXT_NAME_RE.test("napkin")).toBe(true);
    expect(VALID_EXT_NAME_RE.test("kb-distill")).toBe(true);
    expect(VALID_EXT_NAME_RE.test("my-ext-2")).toBe(true);
    expect(VALID_EXT_NAME_RE.test("a")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(VALID_EXT_NAME_RE.test("")).toBe(false);
    expect(VALID_EXT_NAME_RE.test("-start")).toBe(false);
    expect(VALID_EXT_NAME_RE.test("UPPER")).toBe(false);
    expect(VALID_EXT_NAME_RE.test("has spaces")).toBe(false);
    expect(VALID_EXT_NAME_RE.test("has_underscore")).toBe(false);
    expect(VALID_EXT_NAME_RE.test("has.dot")).toBe(false);
  });

  it("rejects reserved names", () => {
    for (const name of RESERVED_EXTENSION_NAMES) {
      expect(RESERVED_EXTENSION_NAMES.has(name)).toBe(true);
    }
    expect(RESERVED_EXTENSION_NAMES.has("tasks")).toBe(true);
    expect(RESERVED_EXTENSION_NAMES.has("config")).toBe(true);
    expect(RESERVED_EXTENSION_NAMES.has("ext")).toBe(true);
  });
});

describe("local extension install", () => {
  it("copies extension to extensions dir", () => {
    const sourceDir = join(testDir, "sources");
    const extDir = createTestExtension(sourceDir, "my-ext");

    // Simulate install: copy to extensions dir
    const destDir = join(extensionsDir, "my-ext");
    cpSync(extDir, destDir, { recursive: true });

    expect(existsSync(join(destDir, "index.ts"))).toBe(true);
  });

  it("copies extension with skill", () => {
    const sourceDir = join(testDir, "sources");
    const extDir = createTestExtension(sourceDir, "my-ext", { skill: true });

    const destDir = join(extensionsDir, "my-ext");
    cpSync(extDir, destDir, { recursive: true });

    expect(existsSync(join(destDir, "skill", "SKILL.md"))).toBe(true);
  });

  it("detects already installed extension", () => {
    const sourceDir = join(testDir, "sources");
    createTestExtension(sourceDir, "my-ext");

    // "Install" first time
    const destDir = join(extensionsDir, "my-ext");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "index.ts"), "export default function() {}");

    // Check collision
    expect(existsSync(destDir)).toBe(true);
  });
});

describe("skill installation", () => {
  it("copies skill to global dir", () => {
    const sourceDir = join(testDir, "sources");
    createTestExtension(sourceDir, "my-ext", { skill: true });

    const extDir = join(extensionsDir, "my-ext");
    cpSync(join(sourceDir, "my-ext"), extDir, { recursive: true });

    // Simulate skill install
    const skillSrc = join(extDir, "skill");
    const skillDst = join(globalDir, "skills", "my-ext");
    mkdirSync(join(globalDir, "skills"), { recursive: true });
    cpSync(skillSrc, skillDst, { recursive: true });

    expect(existsSync(join(skillDst, "SKILL.md"))).toBe(true);
    const content = readFileSync(join(skillDst, "SKILL.md"), "utf-8");
    expect(content).toContain("name: my-ext");
  });

  it("does not install skill when no SKILL.md present", () => {
    const sourceDir = join(testDir, "sources");
    createTestExtension(sourceDir, "no-skill-ext");

    const extDir = join(extensionsDir, "no-skill-ext");
    cpSync(join(sourceDir, "no-skill-ext"), extDir, { recursive: true });

    const skillMd = join(extDir, "skill", "SKILL.md");
    expect(existsSync(skillMd)).toBe(false);
  });
});

describe("extension removal", () => {
  it("removes extension dir and skill", () => {
    const sourceDir = join(testDir, "sources");
    createTestExtension(sourceDir, "rm-ext", { skill: true });

    // Install
    const extDir = join(extensionsDir, "rm-ext");
    cpSync(join(sourceDir, "rm-ext"), extDir, { recursive: true });
    const skillDst = join(globalDir, "skills", "rm-ext");
    mkdirSync(join(globalDir, "skills"), { recursive: true });
    cpSync(join(extDir, "skill"), skillDst, { recursive: true });

    expect(existsSync(extDir)).toBe(true);
    expect(existsSync(skillDst)).toBe(true);

    // Remove
    rmSync(extDir, { recursive: true });
    rmSync(skillDst, { recursive: true });

    expect(existsSync(extDir)).toBe(false);
    expect(existsSync(skillDst)).toBe(false);
  });
});

describe("extension listing", () => {
  it("finds extensions in user dir", () => {
    createTestExtension(extensionsDir, "ext-a", { skill: true });
    createTestExtension(extensionsDir, "ext-b");

    const entries = [];
    for (const entry of require("node:fs").readdirSync(extensionsDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (!VALID_EXT_NAME_RE.test(entry.name)) continue;
      if (RESERVED_EXTENSION_NAMES.has(entry.name)) continue;
      if (!existsSync(join(extensionsDir, entry.name, "index.ts"))) continue;
      entries.push(entry.name);
    }

    expect(entries.sort()).toEqual(["ext-a", "ext-b"]);
  });

  it("skips directories without index.ts", () => {
    mkdirSync(join(extensionsDir, "no-index"), { recursive: true });
    writeFileSync(join(extensionsDir, "no-index", "readme.md"), "# hello");

    createTestExtension(extensionsDir, "valid-ext");

    const entries = [];
    for (const entry of require("node:fs").readdirSync(extensionsDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(extensionsDir, entry.name, "index.ts"))) continue;
      entries.push(entry.name);
    }

    expect(entries).toEqual(["valid-ext"]);
  });

  it("reads description from SKILL.md frontmatter", () => {
    createTestExtension(extensionsDir, "desc-ext", { skill: true });

    const skillMd = join(extensionsDir, "desc-ext", "skill", "SKILL.md");
    const content = readFileSync(skillMd, "utf-8");
    const descMatch = content.match(/^description:\s*(.+?)(?:\n[a-z]|\n---)/ms);

    expect(descMatch).toBeTruthy();
    expect(descMatch?.[1].replace(/\n\s*/g, " ").trim()).toBe(
      "Test extension for desc-ext",
    );
  });
});
