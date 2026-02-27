# Container Lifecycle

BearClaw runs agent code inside Docker containers. This document covers how containers are managed, what happens when they fail, and how the system recovers.

## Container Identity

Each container is tagged for tracking and cleanup:

| Property | Format | Purpose |
|----------|--------|---------|
| **Name** | `bearclaw-<timestamp>-<id>` | Unique identifier for logging/debugging |
| **Label** | `bearclaw.managed=true` | Identifies bearclaw-owned containers for cleanup |

Example:
```
docker ps --filter "label=bearclaw.managed=true"
CONTAINER ID   IMAGE              NAMES
a1b2c3d4e5f6   bearclaw-agent     bearclaw-1709312456789-1
```

## Timeout

Containers have a maximum runtime to prevent runaway processes.

| Config | Env Var | Default | Range |
|--------|---------|---------|-------|
| `containerTimeoutMs` | `BEARCLAW_CONTAINER_TIMEOUT_MS` | 5 minutes | 10s – 1h |

When a container exceeds the timeout:
1. Container is killed via `docker kill`
2. `ContainerError` thrown with `reason: "timeout"`
3. User sees: "Container timed out."
4. Queue unblocks, next message can proceed

## Error Types

Container failures are classified by `ContainerError`:

| Reason | Exit Code | Cause | User Message |
|--------|-----------|-------|--------------|
| `timeout` | — | Exceeded `containerTimeoutMs` | "Container timed out." |
| `oom` | 137 | SIGKILL (OOM, resource limits, or manual kill) | "Container was killed (possibly out of memory)." |
| `aborted` | — | User sent `stop` command | "Stopped current run." |
| `error` | non-zero | Agent crashed or failed | *(error thrown, logged)* |

Exit code 137 = 128 + 9 (SIGKILL), typically from Docker's OOM killer.

## Orphan Cleanup

If the host process crashes or restarts while containers are running, those containers become orphans. On startup, bearclaw cleans them up:

```
Startup
  │
  └─► runtime.initialize()
        │
        └─► containerRunner.cleanupOrphans()
              │
              ├─► docker ps -a --filter "label=bearclaw.managed=true"
              ├─► docker rm -f <container-ids>
              └─► Log: "Cleaned up N orphaned container(s)"
```

This ensures:
- No zombie containers consuming resources
- No blocked group queues from previous runs
- Clean state before accepting new work

## Lifecycle Diagram

```
Message received
  │
  ├─► Queue (one per group)
  │
  ├─► Spawn container
  │     • --name bearclaw-<ts>-<id>
  │     • --label bearclaw.managed=true
  │     • --rm (auto-remove on exit)
  │
  ├─► Start timeout timer
  │
  ├─► Wait for completion
  │     │
  │     ├─► Success (exit 0) → parse reply → respond
  │     ├─► Timeout → kill container → ContainerError(timeout)
  │     ├─► OOM (exit 137) → ContainerError(oom)
  │     ├─► Aborted → ContainerError(aborted)
  │     └─► Other failure → ContainerError(error)
  │
  └─► Cleanup
        • Clear timeout timer
        • Remove from tracking map
        • Queue unblocks (finally block)
```

## Configuration

```bash
# Set container timeout to 10 minutes
export BEARCLAW_CONTAINER_TIMEOUT_MS=600000

# Use a custom container image
export BEARCLAW_AGENT_CONTAINER_IMAGE=my-agent:latest
```

## API

### `AgentContainerRunner`

```ts
runner.cleanupOrphans()     // Remove orphaned containers (called on startup)
runner.reply(input)         // Run container, returns reply string
runner.abort(groupId)       // Kill container for a group
runner.killAll()            // Kill all running containers (shutdown)
runner.isRunning(groupId)   // Check if container is active
runner.activeCount          // Number of running containers
```

### `BearClawCoreRuntime`

```ts
await runtime.initialize()  // Call before accepting work (runs orphan cleanup)
```

### `ContainerError`

```ts
import { ContainerError } from "./agent/container-error.js";

// Properties
error.reason    // "timeout" | "oom" | "aborted" | "error"
error.exitCode  // number | null
error.message   // Human-readable description

// Factory methods
ContainerError.timeout(groupId)
ContainerError.oom(groupId, exitCode)
ContainerError.aborted(groupId)
ContainerError.error(exitCode, output)
```
