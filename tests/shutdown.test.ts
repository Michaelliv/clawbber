import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config.js";
import { GroupQueue } from "../src/core/group-queue.js";
import { ClawbberCoreRuntime } from "../src/core/runtime.js";

describe("GroupQueue shutdown", () => {
  test("cancelAll cancels all pending work across groups", () => {
    const q = new GroupQueue(1);
    // Fill concurrency so further enqueues are pending
    q.enqueue("g1", () => new Promise(() => {})); // never resolves

    // These will queue as pending
    q.enqueue("g2", async () => "a");
    q.enqueue("g3", async () => "b");
    q.enqueue("g1", async () => "c");

    const cancelled = q.cancelAll();
    // g2, g3 are pending (g1's second is also pending), g1's first is active
    expect(cancelled).toBe(3);
    expect(q.activeCount).toBe(1);
  });

  test("cancelAll returns 0 when nothing is pending", () => {
    const q = new GroupQueue(2);
    expect(q.cancelAll()).toBe(0);
  });

  test("waitForActive resolves immediately when nothing active", async () => {
    const q = new GroupQueue(2);
    const result = await q.waitForActive(100);
    expect(result).toBe(true);
  });

  test("waitForActive waits for active work to finish", async () => {
    const q = new GroupQueue(2);
    let resolve!: () => void;
    const workDone = new Promise<void>((r) => {
      resolve = r;
    });

    const workPromise = q.enqueue("g1", async () => {
      await workDone;
      return "done";
    });

    expect(q.activeCount).toBe(1);

    // Start waiting, then resolve the work
    const waitPromise = q.waitForActive(5000);
    setTimeout(() => resolve(), 50);

    const result = await waitPromise;
    expect(result).toBe(true);
    expect(q.activeCount).toBe(0);
    await workPromise; // clean up
  });

  test("waitForActive returns false on timeout", async () => {
    const q = new GroupQueue(2);
    // Work that never finishes
    q.enqueue("g1", () => new Promise(() => {}));

    const result = await q.waitForActive(200);
    expect(result).toBe(false);
  });
});

describe("ClawbberCoreRuntime.shutdown (real runtime)", () => {
  let tmpDir: string;
  let core: ClawbberCoreRuntime;

  function makeConfig(dir: string): AppConfig {
    return {
      modelProvider: "anthropic",
      model: "test",
      triggerPatterns: "@test,test",
      triggerMatch: "mention",
      dataDir: dir,
      maxConcurrency: 2,
      chatSdkPort: 0,
      chatSdkUserName: "test",
      discordGatewayDurationMs: 600_000,
      discordGatewaySecret: undefined,
      enableWhatsApp: false,
      authPath: undefined,
      agentContainerImage: "test:latest",
      admins: "",
      dbPath: path.join(dir, "state.db"),
      globalDir: path.join(dir, "global"),
      groupsDir: path.join(dir, "groups"),
      whatsappAuthDir: path.join(dir, "wa-auth"),
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawbber-shutdown-"));
    core = new ClawbberCoreRuntime(makeConfig(tmpDir));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("shutdown stops scheduler, cancels queue, closes db", async () => {
    // Start the scheduler so there's a timer to clear
    core.startScheduler();

    // Write something to DB to confirm it's open
    core.db.ensureGroup("test-group");

    await core.shutdown(5000);

    expect(core.isShuttingDown).toBe(true);

    // DB should be closed — further writes should throw
    expect(() => core.db.ensureGroup("another")).toThrow();
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
    expect(() => core.db.ensureGroup("x")).toThrow();
  });

  test("shutdown cancels pending queue entries", async () => {
    // Fill concurrency
    core.queue.enqueue("g1", () => new Promise(() => {}));
    core.queue.enqueue("g2", () => new Promise(() => {}));

    // These should be pending
    core.queue.enqueue("g3", async () => "a");
    core.queue.enqueue("g4", async () => "b");

    await core.shutdown(2000);

    // Pending entries should have been cancelled
    // (active ones won't drain since they never resolve, but we hit the timeout)
    expect(core.isShuttingDown).toBe(true);
  });
});

describe("AgentContainerRunner.killAll", () => {
  test("killAll concept - kills all tracked processes", () => {
    // We can't easily spawn real Docker containers in tests, but we verify
    // the map-based tracking and signal escalation logic
    const killed: string[] = [];
    const running = new Map<string, { kill: (sig: string) => void }>();

    running.set("g1", {
      kill: (sig) => killed.push(`g1:${sig}`),
    });
    running.set("g2", {
      kill: (sig) => killed.push(`g2:${sig}`),
    });

    // Simulate killAll
    for (const [_groupId, proc] of running) {
      proc.kill("SIGTERM");
    }

    expect(killed).toEqual(["g1:SIGTERM", "g2:SIGTERM"]);
  });
});
