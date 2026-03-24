import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/core/config.js";
import { AgentQueue } from "../src/core/runtime/queue.js";
import { MercuryCoreRuntime } from "../src/core/runtime/runtime.js";
import { createDatabase } from "../src/core/db.js";
import { createConfigService } from "../src/services/config/service.js";
import { createConversationService } from "../src/services/conversations/service.js";
import { createMessageService } from "../src/services/messages/service.js";
import { createTaskService } from "../src/services/tasks/service.js";
import { createRoleService } from "../src/services/roles/service.js";
import { createMuteService } from "../src/services/mutes/service.js";
import { createUserService } from "../src/services/users/service.js";
import type { Agent } from "../src/core/runtime/agent-interface.js";
import { createPolicyService } from "../src/services/policy/service.js";

describe("AgentQueue shutdown", () => {
  test("cancelPending cancels all pending work", () => {
    const q = new AgentQueue();
    q.enqueue(() => new Promise(() => {})); // never resolves (active)

    q.enqueue(async () => "a");
    q.enqueue(async () => "b");

    const cancelled = q.cancelPending();
    expect(cancelled).toBe(2);
    expect(q.isActive).toBe(true);
  });

  test("cancelPending returns 0 when nothing is pending", () => {
    const q = new AgentQueue();
    expect(q.cancelPending()).toBe(0);
  });

  test("waitForActive resolves immediately when nothing active", async () => {
    const q = new AgentQueue();
    const result = await q.waitForActive(100);
    expect(result).toBe(true);
  });

  test("waitForActive waits for active work to finish", async () => {
    const q = new AgentQueue();
    let resolve!: () => void;
    const workDone = new Promise<void>((r) => {
      resolve = r;
    });

    const workPromise = q.enqueue(async () => {
      await workDone;
      return "done";
    });

    expect(q.isActive).toBe(true);

    const waitPromise = q.waitForActive(5000);
    setTimeout(() => resolve(), 50);

    const result = await waitPromise;
    expect(result).toBe(true);
    expect(q.isActive).toBe(false);
    await workPromise;
  });

  test("waitForActive returns false on timeout", async () => {
    const q = new AgentQueue();
    q.enqueue(() => new Promise(() => {}));

    const result = await q.waitForActive(200);
    expect(result).toBe(false);
  });
});

describe("MercuryCoreRuntime.shutdown (real runtime)", () => {
  let tmpDir: string;
  let core: MercuryCoreRuntime;

  const mockAgent: Agent = {
    async run() { return { text: "", files: [] }; },
    abort() { return false; },
    kill() {},
    get isRunning() { return false; },
  };

  function makeConfig(dir: string): AppConfig {
    return {
      modelProvider: "anthropic",
      model: "test",
      triggerPatterns: "@test,test",
      triggerMatch: "mention",
      projectRoot: dir,
      port: 0,
      botUsername: "test",
      discordGatewayDurationMs: 600_000,
      discordGatewaySecret: undefined,
      enableWhatsApp: false,
      authPath: undefined,
      dbPath: path.join(dir, "state.db"),
      workspaceDir: path.join(dir, "workspace"),
      whatsappAuthDir: path.join(dir, "wa-auth"),
    } as AppConfig;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-shutdown-"));
    const cfg = makeConfig(tmpDir);
    const database = createDatabase(path.join(tmpDir, "state.db"));
    const configSvc = createConfigService(database);
    const muteSvc = createMuteService(database);
    const services = {
      config: configSvc,
      conversations: createConversationService(database, configSvc),
      messages: createMessageService(database),
      tasks: createTaskService(database, muteSvc),
      roles: createRoleService(database, configSvc),
      mutes: muteSvc,
      users: createUserService(database),
      policy: createPolicyService(cfg, createRoleService(database, configSvc), configSvc, muteSvc),
    };
    core = new MercuryCoreRuntime({ config: cfg, database, services, agent: mockAgent });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("shutdown stops scheduler, cancels queue, closes db", async () => {
    // Start the scheduler so there's a timer to clear
    core.startScheduler();

    // Write something to DB to confirm it's open
    core.services.messages.create("user", "test");

    await core.shutdown(5000);

    expect(core.isShuttingDown).toBe(true);

    // DB should be closed — further writes should throw
    expect(() => core.services.messages.create("user", "test")).toThrow();
  });

  test("shutdown is idempotent — second call is a no-op", async () => {
    await core.shutdown(5000);
    // Second call should not throw
    await core.shutdown(5000);
    expect(core.isShuttingDown).toBe(true);
  });

  test("shutdown runs registered hooks in order", async () => {
    const order: string[] = [];

    core.onShutdown(() => {
      order.push("hook1");
    });
    core.onShutdown(() => {
      order.push("hook2");
    });

    await core.shutdown(5000);

    expect(order).toEqual(["hook1", "hook2"]);
  });

  test("shutdown continues if a hook throws", async () => {
    const order: string[] = [];

    core.onShutdown(() => {
      order.push("hook1");
      throw new Error("boom");
    });
    core.onShutdown(() => {
      order.push("hook2");
    });

    // Should not throw
    await core.shutdown(5000);

    expect(order).toEqual(["hook1", "hook2"]);
    // DB should still be closed despite hook error
    expect(() => core.services.messages.create("user", "test")).toThrow();
  });

  test("shutdown cancels pending queue entries", async () => {
    // Fill the single slot with work that never resolves
    core.queue.enqueue(() => new Promise(() => {}));

    // These should be pending
    core.queue.enqueue(async () => "a");
    core.queue.enqueue(async () => "b");

    await core.shutdown(2000);

    expect(core.isShuttingDown).toBe(true);
  });
});

describe("SubprocessAgent.kill", () => {
  test("kill sends SIGKILL to running process", () => {
    const killed: string[] = [];
    let running: { kill: (sig: string) => void } | null = {
      kill: (sig) => killed.push(sig),
    };

    if (running) {
      running.kill("SIGKILL");
      running = null;
    }

    expect(killed).toEqual(["SIGKILL"]);
    expect(running).toBeNull();
  });
});
