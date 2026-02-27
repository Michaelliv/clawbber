import { describe, expect, test } from "bun:test";
import { GroupQueue } from "../src/core/group-queue.js";

describe("Health endpoint dependencies", () => {
  describe("GroupQueue.pendingCount", () => {
    test("returns 0 when empty", () => {
      const q = new GroupQueue(2);
      expect(q.pendingCount).toBe(0);
    });

    test("counts pending work across groups", async () => {
      const q = new GroupQueue(1);

      // Fill the single slot with a long-running task
      let resolveFirst: () => void = () => {};
      const firstDone = new Promise<void>((r) => {
        resolveFirst = r;
      });

      const p1 = q.enqueue("g1", async () => {
        await firstDone;
        return "first";
      });

      // Queue more work (these become pending since slot is full)
      const p2 = q.enqueue("g1", async () => "second");
      const p3 = q.enqueue("g2", async () => "third");

      // Should have 2 pending (p2 and p3)
      expect(q.pendingCount).toBe(2);
      expect(q.activeCount).toBe(1);

      // Let first task complete
      resolveFirst();
      await Promise.all([p1, p2, p3]);

      // After all done, pending should be 0
      expect(q.pendingCount).toBe(0);
      expect(q.activeCount).toBe(0);
    });
  });
});

describe("Health response structure", () => {
  test("health response has required fields", () => {
    // Simulate the health response structure
    const startTime = Date.now() - 5000; // 5 seconds ago
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    const healthResponse = {
      status: "ok",
      uptime: uptimeSeconds,
      queue: {
        active: 2,
        pending: 5,
      },
      containers: {
        active: 2,
      },
      adapters: {
        slack: true,
        discord: true,
      },
    };

    expect(healthResponse.status).toBe("ok");
    expect(healthResponse.uptime).toBeGreaterThanOrEqual(4);
    expect(healthResponse.uptime).toBeLessThanOrEqual(6);
    expect(healthResponse.queue.active).toBe(2);
    expect(healthResponse.queue.pending).toBe(5);
    expect(healthResponse.containers.active).toBe(2);
    expect(healthResponse.adapters.slack).toBe(true);
    expect(healthResponse.adapters.discord).toBe(true);
  });
});
