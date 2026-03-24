import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { loadConfig, resolveProjectPath } from "../src/core/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all MERCURY_ env vars before each test to isolate from .env file
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("MERCURY_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env after each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("MERCURY_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test("defaults", () => {
    const config = loadConfig();
    expect(config.projectRoot).toBe(".");
    expect(config.triggerPatterns).toBe("@Pi,Pi");
    expect(config.triggerMatch).toBe("mention");
    expect(config.port).toBe(8787);
    expect(config.agentTimeoutMs).toBe(15 * 60 * 1000);
    expect(config.logLevel).toBe("info");
    expect(config.logFormat).toBe("text");
  });

  test("derived paths use projectRoot", () => {
    process.env.MERCURY_PROJECT_ROOT = "/custom/project";
    const config = loadConfig();
    expect(config.dbPath).toBe("/custom/project/state.db");
    expect(config.workspaceDir).toBe("/custom/project/workspace");
    expect(config.whatsappAuthDir).toBe("/custom/project/whatsapp-auth");
  });

  test("env overrides", () => {
    process.env.MERCURY_TRIGGER_PATTERNS = "@Bot,Bot";
    process.env.MERCURY_TRIGGER_MATCH = "prefix";
    process.env.MERCURY_AGENT_TIMEOUT_MS = "120000";
    process.env.MERCURY_LOG_LEVEL = "debug";
    process.env.MERCURY_LOG_FORMAT = "json";

    const config = loadConfig();
    expect(config.triggerPatterns).toBe("@Bot,Bot");
    expect(config.triggerMatch).toBe("prefix");
    expect(config.agentTimeoutMs).toBe(120000);
    expect(config.logLevel).toBe("debug");
    expect(config.logFormat).toBe("json");
  });
});

describe("resolveProjectPath", () => {
  test("absolute path returns as-is", () => {
    expect(resolveProjectPath("/absolute/path")).toBe("/absolute/path");
  });

  test("relative path resolves against cwd", () => {
    const result = resolveProjectPath("state.db");
    expect(result).toBe(path.join(process.cwd(), "state.db"));
  });
});
