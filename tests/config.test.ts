import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { loadConfig, resolveProjectPath } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CLAWSOME_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test("defaults", () => {
    const config = loadConfig();
    expect(config.dataDir).toBe(".clawsome");
    expect(config.dbPath).toBe(path.join(".clawsome", "state.db"));
    expect(config.globalDir).toBe(path.join(".clawsome", "global"));
    expect(config.groupsDir).toBe(path.join(".clawsome", "groups"));
    expect(config.whatsappAuthDir).toBe(path.join(".clawsome", "whatsapp-auth"));
    expect(config.triggerPatterns).toBe("@Pi,Pi");
    expect(config.triggerMatch).toBe("mention");
    expect(config.maxConcurrency).toBe(2);
    expect(config.chatSdkPort).toBe(8787);
  });

  test("derived paths use dataDir", () => {
    process.env.CLAWSOME_DATA_DIR = "/custom/data";
    const config = loadConfig();
    expect(config.dbPath).toBe("/custom/data/state.db");
    expect(config.globalDir).toBe("/custom/data/global");
    expect(config.groupsDir).toBe("/custom/data/groups");
    expect(config.whatsappAuthDir).toBe("/custom/data/whatsapp-auth");
  });

  test("env overrides", () => {
    process.env.CLAWSOME_TRIGGER_PATTERNS = "@Bot,Bot";
    process.env.CLAWSOME_TRIGGER_MATCH = "prefix";
    process.env.CLAWSOME_ADMINS = "user1,user2";
    process.env.CLAWSOME_MAX_CONCURRENCY = "4";

    const config = loadConfig();
    expect(config.triggerPatterns).toBe("@Bot,Bot");
    expect(config.triggerMatch).toBe("prefix");
    expect(config.admins).toBe("user1,user2");
    expect(config.maxConcurrency).toBe(4);
  });
});

describe("resolveProjectPath", () => {
  test("absolute path returns as-is", () => {
    expect(resolveProjectPath("/absolute/path")).toBe("/absolute/path");
  });

  test("relative path resolves against cwd", () => {
    const result = resolveProjectPath(".clawsome/state.db");
    expect(result).toBe(path.join(process.cwd(), ".clawsome/state.db"));
  });
});
