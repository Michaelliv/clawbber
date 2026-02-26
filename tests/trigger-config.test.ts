import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTriggerConfig } from "../src/core/trigger.js";
import { Db } from "../src/storage/db.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawbber-test-"));
  db = new Db(path.join(tmpDir, "state.db"));
  db.ensureGroup("g1");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadTriggerConfig", () => {
  test("invalid match mode in DB falls back to default", () => {
    db.setGroupConfig("g1", "trigger.match", "invalid", "admin");
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "mention",
    });
    expect(config.match).toBe("mention");
  });

  test("invalid default match falls back to mention", () => {
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "bogus",
    });
    expect(config.match).toBe("mention");
  });

  test("valid match mode from DB is used", () => {
    db.setGroupConfig("g1", "trigger.match", "always", "admin");
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "mention",
    });
    expect(config.match).toBe("always");
  });

  test("patterns from DB override defaults", () => {
    db.setGroupConfig("g1", "trigger.patterns", "@Bot,Bot", "admin");
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "mention",
    });
    expect(config.patterns).toEqual(["@Bot", "Bot"]);
  });

  test("empty patterns string falls back to defaults", () => {
    db.setGroupConfig("g1", "trigger.patterns", "", "admin");
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "mention",
    });
    expect(config.patterns).toEqual(["@Pi"]);
  });

  test("case_sensitive from DB", () => {
    db.setGroupConfig("g1", "trigger.case_sensitive", "true", "admin");
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "mention",
    });
    expect(config.caseSensitive).toBe(true);
  });

  test("case_sensitive defaults to false", () => {
    const config = loadTriggerConfig(db, "g1", {
      patterns: ["@Pi"],
      match: "mention",
    });
    expect(config.caseSensitive).toBe(false);
  });
});
