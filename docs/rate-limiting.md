# Rate Limiting

Mercury rate limits messages per-user per-space to prevent abuse. This protects against users flooding the agent or bot loops exhausting resources.

## How It Works

```
Message received
  │
  ├─► Route (trigger check, permissions)
  │
  ├─► Type = "assistant"?
  │     │
  │     ├─► Check rate limit
  │     │     • Key: spaceId:userId
  │     │     • Count requests in sliding window
  │     │     • Compare against effective limit
  │     │
  │     ├─► Under limit → record request → continue
  │     └─► Over limit → return "Rate limit exceeded"
  │
  └─► Type = "command" / "ignore" → bypass rate limit
```

Commands like `stop` and `compact` bypass rate limiting so users can always abort runaway containers.

## Configuration

| Config | Env Var | Default | Range |
|--------|---------|---------|-------|
| `rateLimitPerUser` | `MERCURY_RATE_LIMIT_PER_USER` | 10 | 1 – 1000 |
| `rateLimitWindowMs` | `MERCURY_RATE_LIMIT_WINDOW_MS` | 60000 (1 min) | 1s – 1h |

```bash
# Allow 5 requests per user per space per minute
export MERCURY_RATE_LIMIT_PER_USER=5
export MERCURY_RATE_LIMIT_WINDOW_MS=60000
```

## Per-Space Override

Spaces can set a custom limit via `mrctl` or the API:

```bash
# Inside agent container (space context is automatic)
mrctl config set rate_limit 5

# Via API with explicit space
curl -X PUT http://localhost:8787/api/config \
  -H "X-Mercury-Space: slack:C123" \
  -H "X-Mercury-Caller: slack:U456" \
  -H "Content-Type: application/json" \
  -d '{"key": "rate_limit", "value": "5"}'
```

The per-space `rate_limit` config takes precedence over the global `MERCURY_RATE_LIMIT_PER_USER`.

## Behavior

| Scenario | Result |
|----------|--------|
| Under limit | Request proceeds normally |
| Over limit | Returns `{ type: "denied", reason: "Rate limit exceeded. Try again shortly." }` |
| Command (stop, compact) | Always allowed, bypasses rate limit |
| Ignored message | Not counted toward limit |
| Different user | Separate limit bucket |
| Different space | Separate limit bucket |

## Algorithm

Uses a sliding window approach:

1. Key is `${spaceId}:${userId}`
2. Each request timestamp is stored in an array
3. On check: filter to timestamps within window, count
4. If count < limit: record new timestamp, allow
5. If count >= limit: reject

Expired entries are cleaned up periodically (every 60s) to prevent memory leaks.

## API

### `RateLimiter`

```ts
const limiter = new RateLimiter(maxRequests, windowMs);

limiter.isAllowed(spaceId, userId)           // Check + record, returns boolean
limiter.isAllowed(spaceId, userId, override) // With per-call limit override
limiter.getRemaining(spaceId, userId)        // Requests left in window
limiter.startCleanup(intervalMs?)            // Start periodic cleanup (default 60s)
limiter.stopCleanup()                        // Stop cleanup timer
limiter.cleanup()                            // Manual cleanup, returns removed count
limiter.clear()                              // Reset all state
limiter.bucketCount                          // Number of tracked user/space pairs
```

### `MercuryCoreRuntime`

```ts
runtime.rateLimiter                          // Access the rate limiter instance
```

The rate limiter is initialized in the constructor and starts cleanup in `runtime.initialize()`.

## Example

```
User sends 10 messages in quick succession:

Message 1:  ✓ allowed (1/10)
Message 2:  ✓ allowed (2/10)
...
Message 10: ✓ allowed (10/10)
Message 11: ✗ denied — "Rate limit exceeded. Try again shortly."
Message 12: ✗ denied

[60 seconds pass, window slides]

Message 13: ✓ allowed (1/10)
```

## User Muting

For persistent abuse, the agent can mute individual users. Muted users' messages are silently dropped — no container runs, no tokens consumed, no response.

### How it works

The agent has `mrctl mute` available but the command uses a two-step confirmation:

1. Agent calls `mrctl mute <user> <duration>` → gets a policy reminder asking it to verify the mute is justified
2. Agent calls again with `--confirm` → mute is applied

This prevents users from tricking the agent into muting others via prompt injection.

### Commands

```bash
mrctl mute <platform-user-id> <duration> [--reason <reason>]
mrctl unmute <platform-user-id>
mrctl mutes
```

Duration formats: `10m`, `1h`, `24h`, `7d`

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mutes` | GET | List active mutes in space |
| `/api/mutes` | POST | Mute a user (two-step confirmation) |
| `/api/mutes/:userId` | DELETE | Unmute a user |

### Agent behavior

The system prompt instructs the agent to:
- Warn the user first
- Mute if they continue being abusive, spamming, trying to exfiltrate secrets, or wasting group resources
- The agent can mute proactively without an admin asking

Mutes are per-space and expire automatically after the specified duration.

## See Also

- [pipeline.md](./pipeline.md) — Message flow and routing
- [container-lifecycle.md](./container-lifecycle.md) — Container timeouts (another abuse protection)
