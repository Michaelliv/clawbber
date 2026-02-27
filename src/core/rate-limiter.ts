/**
 * Sliding window rate limiter for per-user per-group message limiting.
 *
 * Uses a simple sliding window approach: tracks timestamps of recent requests
 * and counts how many fall within the current window.
 */
export class RateLimiter {
  /** Map of "groupId:userId" -> array of request timestamps */
  private readonly buckets = new Map<string, number[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    /** Max requests per user per group within the window */
    private readonly maxRequests: number,
    /** Window size in milliseconds */
    private readonly windowMs: number,
  ) {}

  /**
   * Check if a request is allowed and record it if so.
   * @param limitOverride - Optional per-group limit override
   * @returns true if allowed, false if rate limited
   */
  isAllowed(groupId: string, userId: string, limitOverride?: number): boolean {
    const key = `${groupId}:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const effectiveLimit = limitOverride ?? this.maxRequests;

    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    // Remove timestamps outside the current window
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= effectiveLimit) {
      // Over limit — update bucket with pruned timestamps but don't add new one
      this.buckets.set(key, validTimestamps);
      return false;
    }

    // Under limit — record this request
    validTimestamps.push(now);
    this.buckets.set(key, validTimestamps);
    return true;
  }

  /**
   * Get remaining requests for a user in a group.
   */
  getRemaining(groupId: string, userId: string): number {
    const key = `${groupId}:${userId}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    const timestamps = this.buckets.get(key);
    if (!timestamps) return this.maxRequests;

    const validCount = timestamps.filter((t) => t > windowStart).length;
    return Math.max(0, this.maxRequests - validCount);
  }

  /**
   * Start periodic cleanup of expired entries.
   * Call this once at startup to prevent memory leaks.
   */
  startCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, intervalMs);

    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the cleanup timer.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Remove all expired entries from the bucket map.
   */
  cleanup(): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let removed = 0;

    for (const [key, timestamps] of this.buckets) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.buckets.delete(key);
        removed++;
      } else if (valid.length !== timestamps.length) {
        this.buckets.set(key, valid);
      }
    }

    return removed;
  }

  /**
   * Clear all rate limit state. Useful for testing.
   */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Get the number of tracked buckets (for monitoring).
   */
  get bucketCount(): number {
    return this.buckets.size;
  }
}
