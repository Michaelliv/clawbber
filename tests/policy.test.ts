import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { createDatabase } from "../src/core/db.js";
import { createConfigService } from "../src/services/config/service.js";
import { createRoleService } from "../src/services/roles/service.js";
import { createMuteService } from "../src/services/mutes/service.js";
import { createPolicyService } from "../src/services/policy/service.js";
import { RateLimiter } from "../src/core/runtime/rate-limiter.js";
import type { PolicyService } from "../src/services/policy/interface.js";
import type { AppConfig } from "../src/core/config.js";
import type { IngressMessage } from "../src/core/types.js";
import type { RoleService } from "../src/services/roles/interface.js";
import type { MuteService } from "../src/services/mutes/interface.js";

let tmpDir: string;
let db: Database;
let roles: RoleService;
let mutes: MuteService;
let policy: PolicyService;

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    triggerPatterns: "@bot,bot",
    triggerMatch: "word",
    rateLimitPerUser: 0,
    rateLimitWindowMs: 60000,
    ...overrides,
  } as AppConfig;
}

function msg(overrides?: Partial<IngressMessage>): IngressMessage {
  return {
    platform: "test",
    conversationExternalId: "conv1",
    callerId: "user1",
    text: "bot hello",
    isDM: false,
    isReplyToBot: false,
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-policy-"));
  db = createDatabase(path.join(tmpDir, "state.db"));
  const configSvc = createConfigService(db);
  roles = createRoleService(db, configSvc);
  mutes = createMuteService(db);
  policy = createPolicyService(makeConfig(), roles, configSvc, mutes);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PolicyService", () => {
  describe("trigger matching", () => {
    test("processes group message (trigger matching done by ingress)", () => {
      const result = policy.evaluate(msg({ text: "bot what time is it" }));
      expect(result.action).toBe("process");
      if (result.action === "process") {
        expect(result.prompt).toBe("bot what time is it");
      }
    });

    test("processes any text (policy does not filter by trigger)", () => {
      const result = policy.evaluate(msg({ text: "hello everyone" }));
      expect(result.action).toBe("process");
    });

    test("DMs trigger for admin", () => {
      roles.set("user1", "admin", "test");
      const result = policy.evaluate(msg({ text: "hello", isDM: true }));
      expect(result.action).toBe("process");
    });

    test("DMs denied for default member (no prompt.dm)", () => {
      const result = policy.evaluate(msg({ text: "hello", isDM: true }));
      expect(result.action).toBe("deny");
    });

    test("reply-to-bot triggers in group", () => {
      const result = policy.evaluate(msg({ text: "hello", isReplyToBot: true }));
      expect(result.action).toBe("process");
    });

    test("empty text is ignored", () => {
      const result = policy.evaluate(msg({ text: "" }));
      expect(result.action).toBe("ignore");
    });

    test("whitespace-only text is ignored", () => {
      const result = policy.evaluate(msg({ text: "   " }));
      expect(result.action).toBe("ignore");
    });

    test("@bot mention passes text through unmodified", () => {
      const result = policy.evaluate(msg({ text: "@bot explain this" }));
      expect(result.action).toBe("process");
      if (result.action === "process") {
        expect(result.prompt).toBe("@bot explain this");
      }
    });
  });

  describe("permissions", () => {
    test("default member can prompt in group", () => {
      const result = policy.evaluate(msg({ text: "bot hello" }));
      expect(result.action).toBe("process");
    });

    test("admin can prompt in DM", () => {
      roles.set("user1", "admin", "test");
      const result = policy.evaluate(msg({ text: "hello", isDM: true }));
      expect(result.action).toBe("process");
    });

    test("denied role gets deny result", () => {
      roles.set("user1", "guest", "test");
      const result = policy.evaluate(msg({ text: "bot hello" }));
      expect(result.action).toBe("deny");
    });

    test("admin always has permission", () => {
      roles.set("user1", "admin", "test");
      const result = policy.evaluate(msg({ text: "bot hello" }));
      expect(result.action).toBe("process");
      if (result.action === "process") {
        expect(result.role).toBe("admin");
      }
    });
  });

  describe("mute check", () => {
    test("muted user is ignored", () => {
      mutes.create({ userId: "user1", duration: "10m", confirm: true }, "admin");
      const result = policy.evaluate(msg({ text: "bot hello" }));
      expect(result.action).toBe("ignore");
    });

    test("unmuted user can proceed", () => {
      const result = policy.evaluate(msg({ text: "bot hello" }));
      expect(result.action).toBe("process");
    });
  });

  describe("rate limiting", () => {
    test("rate limited user gets denied", () => {
      const configSvc = createConfigService(db);
      const rateLimiter = new RateLimiter(2, 60000);
      const limited = createPolicyService(makeConfig({ rateLimitPerUser: 2 }), roles, configSvc, mutes, rateLimiter);

      limited.evaluate(msg({ text: "bot one" }));
      limited.evaluate(msg({ text: "bot two" }));
      const result = limited.evaluate(msg({ text: "bot three" }));
      expect(result.action).toBe("deny");
      if (result.action === "deny") {
        expect(result.reason).toContain("Rate limit");
      }
    });

    test("no rate limit when disabled", () => {
      for (let i = 0; i < 10; i++) {
        const result = policy.evaluate(msg({ text: "bot hello" }));
        expect(result.action).toBe("process");
      }
    });
  });

  describe("caller identity", () => {
    test("returns callerId and role in process result", () => {
      roles.set("user1", "admin", "test");
      const result = policy.evaluate(msg({ text: "bot hello", callerId: "user1" }));
      expect(result.action).toBe("process");
      if (result.action === "process") {
        expect(result.callerId).toBe("user1");
        expect(result.role).toBe("admin");
      }
    });
  });
});
