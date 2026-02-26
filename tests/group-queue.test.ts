import { describe, expect, test } from "bun:test";
import { GroupQueue } from "../src/core/group-queue.js";

describe("GroupQueue", () => {
  test("cancelPending on non-existent group returns 0", () => {
    const q = new GroupQueue(2);
    expect(q.cancelPending("nonexistent")).toBe(0);
  });

  test("enqueue executes work", async () => {
    const q = new GroupQueue(2);
    const result = await q.enqueue("g1", async () => 42);
    expect(result).toBe(42);
  });

  test("same group runs serially", async () => {
    const q = new GroupQueue(2);
    const order: number[] = [];

    const p1 = q.enqueue("g1", async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return "a";
    });

    const p2 = q.enqueue("g1", async () => {
      order.push(3);
      return "b";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("a");
    expect(r2).toBe("b");
    // p1 must fully complete before p2 starts
    expect(order).toEqual([1, 2, 3]);
  });

  test("different groups run concurrently", async () => {
    const q = new GroupQueue(2);
    const order: string[] = [];

    const p1 = q.enqueue("g1", async () => {
      order.push("g1-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("g1-end");
    });

    const p2 = q.enqueue("g2", async () => {
      order.push("g2-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("g2-end");
    });

    await Promise.all([p1, p2]);
    // Both should start before either ends
    expect(order.indexOf("g1-start")).toBeLessThan(order.indexOf("g1-end"));
    expect(order.indexOf("g2-start")).toBeLessThan(order.indexOf("g2-end"));
    expect(order.indexOf("g2-start")).toBeLessThan(order.indexOf("g1-end"));
  });

  test("isActive returns true while running", async () => {
    const q = new GroupQueue(2);

    let wasActive = false;
    await q.enqueue("g1", async () => {
      wasActive = q.isActive("g1");
    });

    expect(wasActive).toBe(true);
    expect(q.isActive("g1")).toBe(false);
  });

  test("cancelPending drops queued work", async () => {
    const q = new GroupQueue(1);
    const results: string[] = [];

    // Fill the single slot
    const p1 = q.enqueue("g1", async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push("first");
    });

    // These get queued (slot is full for g1)
    q.enqueue("g1", async () => {
      results.push("second");
    }).catch(() => {});
    q.enqueue("g1", async () => {
      results.push("third");
    }).catch(() => {});

    const dropped = q.cancelPending("g1");
    expect(dropped).toBe(2);

    await p1;
    // Give a tick for any queued work to run (it shouldn't)
    await new Promise((r) => setTimeout(r, 10));
    expect(results).toEqual(["first"]);
  });

  test("respects maxConcurrency across groups", async () => {
    const q = new GroupQueue(1);
    const order: string[] = [];

    const p1 = q.enqueue("g1", async () => {
      order.push("g1-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("g1-end");
    });

    const p2 = q.enqueue("g2", async () => {
      order.push("g2-start");
      order.push("g2-end");
    });

    await Promise.all([p1, p2]);
    // With maxConcurrency=1, g2 must wait for g1
    expect(order).toEqual(["g1-start", "g1-end", "g2-start", "g2-end"]);
  });
});
