# Graceful Shutdown

On `SIGTERM` or `SIGINT`, bearclaw tears down all components in order instead of exiting abruptly.

## Sequence

```
SIGTERM/SIGINT received
  │
  ├─1─► Stop scheduler (clear poll timer)
  ├─2─► Cancel all pending queue entries
  ├─3─► Kill running containers (SIGTERM → SIGKILL)
  ├─4─► Wait for active work to drain (up to 8s)
  ├─5─► Disconnect adapters (WhatsApp socket, etc.)
  ├─6─► Stop HTTP server
  ├─7─► Close SQLite database
  └─8─► exit(0)

  Second signal → force exit(1)
  10s timeout  → force exit(1)
```

## Why this order

1. **Scheduler first** — prevents new work from being created while we're shutting down.
2. **Cancel pending queue entries** — no point starting queued work we'll just kill.
3. **Kill containers** — sends SIGTERM to running Docker processes, escalates to SIGKILL after 2.5s. Containers are labeled with `bearclaw.managed=true` for identification (see [container-lifecycle.md](./container-lifecycle.md)).
4. **Wait for drain** — gives active container runs a chance to finish cleanly (up to 8s).
5. **Disconnect adapters** — closes the WhatsApp socket, Slack/Discord connections. Done after containers so in-flight replies can still be posted.
6. **Stop HTTP server** — stops accepting new webhook/API requests.
7. **Close DB last** — everything above may still write to the database (message storage, task updates), so the DB connection stays open until the very end.

## Safety mechanisms

| Mechanism | Behavior |
|-----------|----------|
| **Double-signal** | Second SIGINT/SIGTERM forces immediate `exit(1)` |
| **Global timeout** | If cleanup takes longer than 10s, forced `exit(1)` |
| **Idempotent** | `shutdown()` is guarded by a `shuttingDown` flag — calling it twice is a no-op |
| **Hook errors** | Individual shutdown hook failures are logged and swallowed — remaining cleanup continues |

## API

### `BearClawCoreRuntime`

```ts
core.installSignalHandlers()     // trap SIGTERM + SIGINT
core.onShutdown(async () => {})  // register cleanup callback
await core.shutdown(timeoutMs?)  // trigger shutdown manually (default 10s)
core.isShuttingDown              // boolean
```

### Component methods used during shutdown

| Component | Method | What it does |
|-----------|--------|-------------|
| `TaskScheduler` | `stop()` | Clears the poll timer |
| `GroupQueue` | `cancelAll()` | Drops all pending entries, returns count |
| `GroupQueue` | `waitForActive(ms)` | Resolves when active count hits 0 or timeout |
| `AgentContainerRunner` | `killAll()` | SIGTERM all running containers |
| `Db` | `close()` | Closes SQLite connection |
| `WhatsAppBaileysAdapter` | `shutdown()` | Ends the Baileys socket |
