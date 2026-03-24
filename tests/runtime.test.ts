import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { createDatabase } from "../src/core/db.js";
import type { AppConfig } from "../src/core/config.js";
import type { Agent, AgentInput } from "../src/core/runtime/agent-interface.js";
import type { AgentOutput, IngressMessage } from "../src/core/types.js";
import { MercuryCoreRuntime } from "../src/core/runtime/runtime.js";
import { createConfigService } from "../src/services/config/service.js";
import { createConversationService } from "../src/services/conversations/service.js";
import { createMessageService } from "../src/services/messages/service.js";
import { createTaskService } from "../src/services/tasks/service.js";
import { createRoleService } from "../src/services/roles/service.js";
import { createMuteService } from "../src/services/mutes/service.js";
import { createUserService } from "../src/services/users/service.js";
import { createPolicyService } from "../src/services/policy/service.js";
import { RateLimiter } from "../src/core/runtime/rate-limiter.js";

let tmpDir: string;
let db: Database;
let core: MercuryCoreRuntime;
let agentCalls: AgentInput[];

function makeConfig(dir: string, overrides?: Partial<AppConfig>): AppConfig {
  return {
    modelProvider: "anthropic",
    model: "test",
    triggerPatterns: "@bot,bot",
    triggerMatch: "word",
    projectRoot: dir,
    port: 0,
    botUsername: "bot",
    dbPath: path.join(dir, "state.db"),
    workspaceDir: path.join(dir, "workspace"),
    whatsappAuthDir: path.join(dir, "wa-auth"),
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

function setup(agentReply = "agent reply", configOverrides?: Partial<AppConfig>) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-runtime-"));
  db = createDatabase(path.join(tmpDir, "state.db"));
  const cfg = makeConfig(tmpDir, configOverrides);

  agentCalls = [];
  const mockAgent: Agent = {
    async run(input: AgentInput): Promise<AgentOutput> {
      agentCalls.push(input);
      return { text: agentReply, files: [] };
    },
    abort() { return false; },
    kill() {},
    get isRunning() { return false; },
  };

  const configSvc = createConfigService(db);
  const rolesSvc = createRoleService(db, configSvc);
  const muteSvc = createMuteService(db);
  const services = {
    config: configSvc,
    conversations: createConversationService(db, configSvc),
    messages: createMessageService(db),
    tasks: createTaskService(db, muteSvc),
    roles: rolesSvc,
    mutes: muteSvc,
    users: createUserService(db),
    policy: createPolicyService(cfg, rolesSvc, configSvc, muteSvc),
  };

  core = new MercuryCoreRuntime({ config: cfg, database: db, services, agent: mockAgent });
}

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Runtime.handleMessage", () => {
  test("processes triggered message and returns agent output", async () => {
    setup("hello world");
    const result = await core.handleMessage(msg({ text: "bot hi" }), "chat-sdk");
    expect(result.action).toBe("process");
    expect(result.result?.text).toBe("hello world");
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0].prompt).toBe("bot hi");
  });

  test("stores user and assistant messages", async () => {
    setup("response");
    await core.handleMessage(msg({ text: "bot question" }), "chat-sdk");
    const history = core.services.messages.list("conv1");
    const roles = history.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  test("non-triggered messages still process (policy no longer filters by trigger)", async () => {
    setup("ok");
    const result = await core.handleMessage(
      msg({ text: "just chatting", authorName: "Alice" }),
      "chat-sdk",
    );
    expect(result.action).toBe("process");
  });

  test("passes caller role to agent", async () => {
    setup();
    core.services.roles.set("user1", "admin", "test");
    await core.handleMessage(msg({ text: "bot do stuff" }), "chat-sdk");
    expect(agentCalls[0].callerRole).toBe("admin");
  });

  test("passes attachments to agent", async () => {
    setup();
    const att = [{ path: "/tmp/test.jpg", type: "image" as const, mimeType: "image/jpeg", filename: "test.jpg", sizeBytes: 100 }];
    await core.handleMessage(msg({ text: "bot look", attachments: att }), "chat-sdk");
    expect(agentCalls[0].attachments).toHaveLength(1);
    expect(agentCalls[0].attachments![0].filename).toBe("test.jpg");
  });

  test("passes authorName to agent", async () => {
    setup();
    await core.handleMessage(msg({ text: "bot hi", authorName: "Bob" }), "chat-sdk");
    expect(agentCalls[0].authorName).toBe("Bob");
  });

  test("passes conversationId to agent", async () => {
    setup();
    await core.handleMessage(msg({ text: "bot hi", conversationExternalId: "my-conv" }), "chat-sdk");
    expect(agentCalls[0].conversationId).toBe("my-conv");
  });

  test("passes isDM to agent", async () => {
    setup();
    core.services.roles.set("user1", "admin", "test");
    await core.handleMessage(msg({ text: "hello", isDM: true }), "chat-sdk");
    expect(agentCalls[0].isDM).toBe(true);
  });

  test("denied policy returns deny without calling agent", async () => {
    setup();
    core.services.roles.set("user1", "guest", "test");
    const result = await core.handleMessage(msg({ text: "bot hi" }), "chat-sdk");
    expect(result.action).toBe("deny");
    expect(agentCalls).toHaveLength(0);
  });

  test("muted user returns ignore without calling agent", async () => {
    setup();
    core.services.mutes.create({ userId: "user1", duration: "10m", confirm: true }, "admin");
    const result = await core.handleMessage(msg({ text: "bot hi" }), "chat-sdk");
    expect(result.action).toBe("ignore");
    expect(agentCalls).toHaveLength(0);
  });

  test("rate limited user returns deny", async () => {
    setup("ok", { rateLimitPerUser: 1 } as any);
    // Recreate with rate limiter
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setup("ok", { rateLimitPerUser: 1, rateLimitWindowMs: 60000 } as any);

    // Need a rate limiter in the policy service
    const configSvc = createConfigService(db);
    const rolesSvc = createRoleService(db, configSvc);
    const muteSvc = createMuteService(db);
    const rateLimiter = new RateLimiter(1, 60000);
    const cfg = makeConfig(tmpDir, { rateLimitPerUser: 1, rateLimitWindowMs: 60000 });
    core.services.policy = createPolicyService(cfg, rolesSvc, configSvc, muteSvc, rateLimiter);

    await core.handleMessage(msg({ text: "bot one" }), "chat-sdk");
    const result = await core.handleMessage(msg({ text: "bot two" }), "chat-sdk");
    expect(result.action).toBe("deny");
    if (result.action === "deny") {
      expect(result.reason).toContain("Rate limit");
    }
  });

  test("message history is passed to agent", async () => {
    setup("first");
    await core.handleMessage(msg({ text: "bot question1" }), "chat-sdk");
    setup("second");
    // Fresh setup loses history, so let's do two calls on same instance
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setup("reply");
    await core.handleMessage(msg({ text: "bot first" }), "chat-sdk");
    agentCalls = [];
    await core.handleMessage(msg({ text: "bot second" }), "chat-sdk");
    expect(agentCalls[0].messages.length).toBeGreaterThan(0);
  });
});
