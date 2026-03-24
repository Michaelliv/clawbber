import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/core/config.js";
import { createDatabase } from "../src/core/db.js";
import { MercuryCoreRuntime } from "../src/core/runtime/runtime.js";
import { createConfigService } from "../src/services/config/service.js";
import { createConversationService } from "../src/services/conversations/service.js";
import { createMessageService } from "../src/services/messages/service.js";
import { createTaskService } from "../src/services/tasks/service.js";
import { createRoleService } from "../src/services/roles/service.js";
import { createMuteService } from "../src/services/mutes/service.js";
import { createUserService } from "../src/services/users/service.js";
import { createIngressService } from "../src/services/ingress/service.js";
import { createPolicyService } from "../src/services/policy/service.js";
import type { Agent } from "../src/core/runtime/agent-interface.js";
import type { MessageChannel } from "../src/services/ingress/interface.js";
import type { Database } from "bun:sqlite";

let tmpDir: string;
let db: Database;
let core: MercuryCoreRuntime;
let sent: string[];
let typingStarted: boolean;
let readMarked: boolean;
let channel: MessageChannel;

const mockAgent: Agent = {
  async run() { return { text: "Hello from agent", files: [] }; },
  abort() { return false; },
  kill() {},
  get isRunning() { return false; },
};

function makeConfig(dir: string): AppConfig {
  return {
    modelProvider: "anthropic",
    model: "test",
    triggerPatterns: "@bot,bot",
    triggerMatch: "mention",
    projectRoot: dir,
    port: 0,
    botUsername: "bot",
    dbPath: path.join(dir, "state.db"),
    workspaceDir: path.join(dir, "workspace"),
    whatsappAuthDir: path.join(dir, "wa-auth"),
    rateLimitPerUser: 0,
    rateLimitWindowMs: 60000,
  } as AppConfig;
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ({}) } as any;

async function pairGroup(ingress: any, platform: string, externalId: string) {
  const code = core.services.conversations.getPairingCode();
  await ingress.handleMessage({
    platform, externalId: "dm-admin", callerId: "admin1",
    text: `/pair ${code}`, isDM: true, isMention: false, attachments: [],
  }, channel);

  const code2 = core.services.conversations.getPairingCode();
  await ingress.handleMessage({
    platform, externalId, callerId: "admin1",
    text: `/pair ${code2}`, isDM: false, isMention: false, attachments: [],
  }, channel);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-ingress-"));
  db = createDatabase(path.join(tmpDir, "state.db"));
  const cfg = makeConfig(tmpDir);
  const configSvc = createConfigService(db);
  const muteSvc = createMuteService(db);
  const rolesSvc = createRoleService(db, configSvc);
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

  sent = [];
  typingStarted = false;
  readMarked = false;
  channel = {
    async send(text: string) { sent.push(text); },
    async sendFiles(text: string) { sent.push(text); },
    async markRead() { readMarked = true; },
    async startTyping() { typingStarted = true; },
  };
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Unpaired conversations", () => {
  test("ignores everything except /pair", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: "hello everyone", isDM: false, isMention: false, attachments: [],
    }, channel);
    expect(sent).toEqual([]);
    expect(readMarked).toBe(false);
  });

  test("ignores mentions in unpaired group", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: "bot hello", isDM: false, isMention: true, attachments: [],
    }, channel);
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toEqual([]);
  });

  test("handles /pair with valid code", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    const code = core.services.conversations.getPairingCode();
    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: `/pair ${code}`, isDM: false, isMention: false, attachments: [],
    }, channel);
    expect(sent).toEqual(["✅ Paired. This conversation is now active."]);
    expect(core.services.conversations.isPaired("test", "group1")).toBe(true);
  });

  test("rejects /pair with invalid code", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: "/pair WRONG1", isDM: false, isMention: false, attachments: [],
    }, channel);
    expect(sent).toEqual(["❌ Invalid pairing code."]);
    expect(core.services.conversations.isPaired("test", "group1")).toBe(false);
  });

  test("ignores slash commands other than /pair", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: "/unpair", isDM: false, isMention: false, attachments: [],
    }, channel);
    expect(sent).toEqual([]);
  });
});

describe("Paired conversations — DM pairing", () => {
  test("/pair in DM grants admin", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    const code = core.services.conversations.getPairingCode();
    await ingress.handleMessage({
      platform: "test", externalId: "dm1", callerId: "user1",
      text: `/pair ${code}`, isDM: true, isMention: false, attachments: [],
    }, channel);
    expect(sent).toEqual(["✅ Paired. You are now an admin."]);
    expect(core.services.roles.get("user1")).toBe("admin");
  });
});

describe("Paired conversations — ambient messages", () => {
  test("non-mentioned message is stored as ambient", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    sent = [];
    readMarked = false;

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      authorName: "Alice",
      text: "hello everyone", isDM: false, isMention: false, attachments: [],
    }, channel);

    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toEqual([]);
    expect(readMarked).toBe(true);

    const msgs = db.prepare("SELECT role, content FROM messages WHERE conversation_id = 'group1'").all() as any[];
    const ambient = msgs.find((m: any) => m.role === "ambient");
    expect(ambient).toBeDefined();
    expect(ambient.content).toBe("Alice: hello everyone");
  });

  test("non-mentioned message does not trigger agent", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    sent = [];
    typingStarted = false;

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: "just chatting", isDM: false, isMention: false, attachments: [],
    }, channel);

    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toEqual([]);
    expect(typingStarted).toBe(false);
  });

  test("ambient includes authorName prefix", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    sent = [];

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      authorName: "Bob",
      text: "what's up", isDM: false, isMention: false, attachments: [],
    }, channel);

    const msgs = db.prepare("SELECT content FROM messages WHERE conversation_id = 'group1' AND role = 'ambient'").all() as any[];
    expect(msgs[0].content).toBe("Bob: what's up");
  });
});

describe("Paired conversations — mentioned / reply to bot", () => {
  test("mentioned message triggers agent", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    sent = [];
    typingStarted = false;

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "user1",
      text: "bot hello", isDM: false, isMention: true, attachments: [],
    }, channel);

    await new Promise((r) => setTimeout(r, 200));
    expect(typingStarted).toBe(true);
    expect(sent).toEqual(["Hello from agent"]);
  });

  test("DM always triggers agent", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    // Pair via DM
    const code = core.services.conversations.getPairingCode();
    await ingress.handleMessage({
      platform: "test", externalId: "dm1", callerId: "user1",
      text: `/pair ${code}`, isDM: true, isMention: false, attachments: [],
    }, channel);
    sent = [];
    typingStarted = false;

    await ingress.handleMessage({
      platform: "test", externalId: "dm1", callerId: "user1",
      text: "hello", isDM: true, isMention: false, attachments: [],
    }, channel);

    await new Promise((r) => setTimeout(r, 200));
    expect(typingStarted).toBe(true);
    expect(sent).toEqual(["Hello from agent"]);
  });

  test("muted user gets no response", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    core.services.mutes.create({ userId: "victim1", duration: "10m", confirm: true }, "admin1");
    sent = [];

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "victim1",
      text: "bot hello", isDM: false, isMention: true, attachments: [],
    }, channel);

    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toEqual([]);
  });
});

describe("Paired conversations — slash commands", () => {
  test("admin can /unpair", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    sent = [];

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "admin1",
      text: "/unpair", isDM: false, isMention: true, attachments: [],
    }, channel);

    expect(sent).toEqual(["✅ Unpaired. I will no longer respond here."]);
    expect(core.services.conversations.isPaired("test", "group1")).toBe(false);
  });

  test("non-admin gets denied on slash commands", async () => {
    const ingress = createIngressService(core, core.config, noopLog);
    await pairGroup(ingress, "test", "group1");
    sent = [];

    await ingress.handleMessage({
      platform: "test", externalId: "group1", callerId: "random-user",
      text: "/unpair", isDM: false, isMention: true, attachments: [],
    }, channel);

    expect(sent).toEqual(["⛔ Admin only."]);
  });
});
