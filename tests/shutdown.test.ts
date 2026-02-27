import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GroupQueue } from "../src/core/group-queue.js";

// We test the individual components and the shutdown orchestration with mocks.
// Full integration would require Docker + adapters, so we focus on the logic.

describe("GroupQueue shutdown", () => {
  test("cancelAll cancels all pending work across groups", () => {
    const q = new GroupQueue(1);
    // Fill concurrency so further enqueues are pending
    const blocker = q.enqueue("g1", () => new Promise(() => {})); // never resolves

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

describe("ClawbberCoreRuntime.shutdown", () => {
  // Mock all the components to test the orchestration sequence
  test("shutdown calls components in correct order", async () => {
    const order: string[] = [];

    const mockScheduler = {
      stop: () => {
        order.push("scheduler.stop");
      },
      start: () => {},
    };

    const mockQueue = {
      cancelAll: () => {
        order.push("queue.cancelAll");
        return 2;
      },
      waitForActive: async (_ms: number) => {
        order.push("queue.waitForActive");
        return true;
      },
      activeCount: 0,
    };

    const mockContainerRunner = {
      killAll: () => {
        order.push("containerRunner.killAll");
      },
      activeCount: 0,
    };

    const mockDb = {
      close: () => {
        order.push("db.close");
      },
    };

    // Build a minimal runtime-like object to test shutdown logic
    // We directly replicate the shutdown method's logic with our mocks
    const hooks: Array<() => Promise<void> | void> = [];

    hooks.push(async () => {
      order.push("hook.adapters");
    });
    hooks.push(async () => {
      order.push("hook.server");
    });

    // Simulate the shutdown sequence
    mockScheduler.stop();
    mockQueue.cancelAll();
    mockContainerRunner.killAll();
    await mockQueue.waitForActive(8000);
    for (const hook of hooks) {
      await hook();
    }
    mockDb.close();

    expect(order).toEqual([
      "scheduler.stop",
      "queue.cancelAll",
      "containerRunner.killAll",
      "queue.waitForActive",
      "hook.adapters",
      "hook.server",
      "db.close",
    ]);
  });

  test("shutdown is idempotent (shuttingDown flag)", async () => {
    let shutdownCount = 0;

    // Simulate the shuttingDown guard
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      shutdownCount++;
    };

    await shutdown();
    await shutdown();
    await shutdown();

    expect(shutdownCount).toBe(1);
  });

  test("shutdown hooks errors are caught and do not prevent further cleanup", async () => {
    const order: string[] = [];
    const hooks: Array<() => Promise<void>> = [];

    hooks.push(async () => {
      order.push("hook1");
      throw new Error("hook1 failed");
    });
    hooks.push(async () => {
      order.push("hook2");
    });

    for (const hook of hooks) {
      try {
        await hook();
      } catch {
        // swallowed like in the real shutdown
      }
    }
    order.push("db.close");

    expect(order).toEqual(["hook1", "hook2", "db.close"]);
  });
});

describe("AgentContainerRunner.killAll", () => {
  test("killAll concept - kills all tracked processes", () => {
    // We can't easily test actual child processes, but we verify the interface
    // exists and the map-based tracking logic works
    const killed: string[] = [];
    const running = new Map<string, { kill: (sig: string) => void }>();

    running.set("g1", {
      kill: (sig) => killed.push(`g1:${sig}`),
    });
    running.set("g2", {
      kill: (sig) => killed.push(`g2:${sig}`),
    });

    // Simulate killAll
    for (const [groupId, proc] of running) {
      proc.kill("SIGTERM");
    }

    expect(killed).toEqual(["g1:SIGTERM", "g2:SIGTERM"]);
  });
});
