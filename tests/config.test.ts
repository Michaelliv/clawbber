import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { loadConfig, resolveProjectPath } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CLAWBBER_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test("defaults", () => {
    const config = loadConfig();
    expect(config.dataDir).toBe(".clawbber");
    expect(config.dbPath).toBe(path.join(".clawbber", "state.db"));
    expect(config.globalDir).toBe(path.join(".clawbber", "global"));
    expect(config.groupsDir).toBe(path.join(".clawbber", "groups"));
    expect(config.whatsappAuthDir).toBe(
      path.join(".clawbber", "whatsapp-auth"),
    );
    expect(config.triggerPatterns).toBe("@Pi,Pi");
    expect(config.triggerMatch).toBe("mention");
    expect(config.maxConcurrency).toBe(2);
    expect(config.chatSdkPort).toBe(8787);
    expect(config.containerTimeoutMs).toBe(5 * 60 * 1000); // 5 minutes default
    expect(config.logLevel).toBe("info");
    expect(config.logFormat).toBe("text");
  });

  test("logLevel and logFormat can be overridden", () => {
    process.env.CLAWBBER_LOG_LEVEL = "debug";
    process.env.CLAWBBER_LOG_FORMAT = "json";
    const config = loadConfig();
    expect(config.logLevel).toBe("debug");
    expect(config.logFormat).toBe("json");
  });

  test("derived paths use dataDir", () => {
    process.env.CLAWBBER_DATA_DIR = "/custom/data";
    const config = loadConfig();
    expect(config.dbPath).toBe("/custom/data/state.db");
    expect(config.globalDir).toBe("/custom/data/global");
    expect(config.groupsDir).toBe("/custom/data/groups");
    expect(config.whatsappAuthDir).toBe("/custom/data/whatsapp-auth");
  });

  test("env overrides", () => {
    process.env.CLAWBBER_TRIGGER_PATTERNS = "@Bot,Bot";
    process.env.CLAWBBER_TRIGGER_MATCH = "prefix";
    process.env.CLAWBBER_ADMINS = "user1,user2";
    process.env.CLAWBBER_MAX_CONCURRENCY = "4";

    const config = loadConfig();
    expect(config.triggerPatterns).toBe("@Bot,Bot");
    expect(config.triggerMatch).toBe("prefix");
    expect(config.admins).toBe("user1,user2");
    expect(config.maxConcurrency).toBe(4);
  });

  test("containerTimeoutMs can be overridden", () => {
    process.env.CLAWBBER_CONTAINER_TIMEOUT_MS = "120000"; // 2 minutes
    const config = loadConfig();
    expect(config.containerTimeoutMs).toBe(120000);
  });
});

describe("resolveProjectPath", () => {
  test("absolute path returns as-is", () => {
    expect(resolveProjectPath("/absolute/path")).toBe("/absolute/path");
  });

  test("relative path resolves against cwd", () => {
    const result = resolveProjectPath(".clawbber/state.db");
    expect(result).toBe(path.join(process.cwd(), ".clawbber/state.db"));
  });
});
