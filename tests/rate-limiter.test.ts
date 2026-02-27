import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/core/rate-limiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000); // 3 requests per second
  });

  afterEach(() => {
    limiter.stopCleanup();
  });

  test("allows requests under limit", () => {
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
  });

  test("blocks requests over limit", () => {
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(false);
    expect(limiter.isAllowed("group1", "user1")).toBe(false);
  });

  test("different users have separate limits", () => {
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(false);

    // user2 should still be allowed
    expect(limiter.isAllowed("group1", "user2")).toBe(true);
    expect(limiter.isAllowed("group1", "user2")).toBe(true);
    expect(limiter.isAllowed("group1", "user2")).toBe(true);
    expect(limiter.isAllowed("group1", "user2")).toBe(false);
  });

  test("different groups have separate limits", () => {
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(true);
    expect(limiter.isAllowed("group1", "user1")).toBe(false);

    // Same user in different group should still be allowed
    expect(limiter.isAllowed("group2", "user1")).toBe(true);
    expect(limiter.isAllowed("group2", "user1")).toBe(true);
    expect(limiter.isAllowed("group2", "user1")).toBe(true);
    expect(limiter.isAllowed("group2", "user1")).toBe(false);
  });

  test("window expires and allows new requests", async () => {
    const shortLimiter = new RateLimiter(2, 100); // 2 requests per 100ms

    expect(shortLimiter.isAllowed("g", "u")).toBe(true);
    expect(shortLimiter.isAllowed("g", "u")).toBe(true);
    expect(shortLimiter.isAllowed("g", "u")).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 150));

    expect(shortLimiter.isAllowed("g", "u")).toBe(true);
    expect(shortLimiter.isAllowed("g", "u")).toBe(true);
    expect(shortLimiter.isAllowed("g", "u")).toBe(false);

    shortLimiter.stopCleanup();
  });

  test("getRemaining returns correct count", () => {
    expect(limiter.getRemaining("group1", "user1")).toBe(3);

    limiter.isAllowed("group1", "user1");
    expect(limiter.getRemaining("group1", "user1")).toBe(2);

    limiter.isAllowed("group1", "user1");
    expect(limiter.getRemaining("group1", "user1")).toBe(1);

    limiter.isAllowed("group1", "user1");
    expect(limiter.getRemaining("group1", "user1")).toBe(0);

    // Blocked request doesn't decrease remaining (it's already 0)
    limiter.isAllowed("group1", "user1");
    expect(limiter.getRemaining("group1", "user1")).toBe(0);
  });

  test("cleanup removes expired entries", async () => {
    const shortLimiter = new RateLimiter(2, 50);

    shortLimiter.isAllowed("g1", "u1");
    shortLimiter.isAllowed("g2", "u2");

    expect(shortLimiter.bucketCount).toBe(2);

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 100));

    const removed = shortLimiter.cleanup();
    expect(removed).toBe(2);
    expect(shortLimiter.bucketCount).toBe(0);

    shortLimiter.stopCleanup();
  });

  test("clear removes all state", () => {
    limiter.isAllowed("g1", "u1");
    limiter.isAllowed("g2", "u2");
    expect(limiter.bucketCount).toBe(2);

    limiter.clear();
    expect(limiter.bucketCount).toBe(0);
    expect(limiter.getRemaining("g1", "u1")).toBe(3);
  });

  test("limitOverride allows per-call limit adjustment", () => {
    // Default limit is 3, but we can override to 1
    expect(limiter.isAllowed("g1", "u1", 1)).toBe(true);
    expect(limiter.isAllowed("g1", "u1", 1)).toBe(false);

    // Different user with default limit still gets 3
    expect(limiter.isAllowed("g1", "u2")).toBe(true);
    expect(limiter.isAllowed("g1", "u2")).toBe(true);
    expect(limiter.isAllowed("g1", "u2")).toBe(true);
    expect(limiter.isAllowed("g1", "u2")).toBe(false);
  });

  test("limitOverride can increase limit beyond default", () => {
    // Default limit is 3, override to 5
    expect(limiter.isAllowed("g1", "u1", 5)).toBe(true);
    expect(limiter.isAllowed("g1", "u1", 5)).toBe(true);
    expect(limiter.isAllowed("g1", "u1", 5)).toBe(true);
    expect(limiter.isAllowed("g1", "u1", 5)).toBe(true);
    expect(limiter.isAllowed("g1", "u1", 5)).toBe(true);
    expect(limiter.isAllowed("g1", "u1", 5)).toBe(false);
  });

  test("startCleanup and stopCleanup work correctly", () => {
    limiter.startCleanup(100);
    // Should not throw when called multiple times
    limiter.startCleanup(100);

    limiter.stopCleanup();
    // Should not throw when called multiple times
    limiter.stopCleanup();
  });
});
