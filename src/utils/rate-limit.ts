/**
 * Rate limiting utilities for Instagram API calls.
 *
 * Empirically tested limits (2026-03-23):
 * - Scan: 1-1.2s between requests, pause 10s every 6 requests
 * - Verify: 1.5s between requests
 * - Unfollow: 3-4s between unfollows, pause 5 min every 15-20 unfollows
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay between min and max ms */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return sleep(delay);
}

export interface RateLimitConfig {
  /** Delay between individual requests (ms) */
  delayMs: number;
  /** Max delay jitter added on top of delayMs */
  jitterMs: number;
  /** Number of requests before a long pause */
  burstSize: number;
  /** Duration of the long pause (ms) */
  burstPauseMs: number;
}

export const RATE_LIMITS = {
  scan: {
    delayMs: 1000,
    jitterMs: 200,
    burstSize: 6,
    burstPauseMs: 10_000,
  } satisfies RateLimitConfig,

  verify: {
    delayMs: 1500,
    jitterMs: 300,
    burstSize: 50,
    burstPauseMs: 30_000,
  } satisfies RateLimitConfig,

  unfollow: {
    delayMs: 3000,
    jitterMs: 1000,
    burstSize: 15,
    burstPauseMs: 300_000, // 5 minutes
  } satisfies RateLimitConfig,
};

/**
 * Creates a rate-limited executor that respects burst pauses.
 */
export function createRateLimiter(config: RateLimitConfig) {
  let requestCount = 0;

  return async function rateLimitedWait(): Promise<void> {
    requestCount++;

    if (requestCount > 1 && requestCount % config.burstSize === 1) {
      // Burst pause
      await sleep(config.burstPauseMs);
    } else if (requestCount > 1) {
      // Normal delay with jitter
      await randomDelay(config.delayMs, config.delayMs + config.jitterMs);
    }
  };
}
