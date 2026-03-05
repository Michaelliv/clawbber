# Extensions

Mercury's extension system lets you add CLIs, skills, background jobs, lifecycle hooks, config keys, and dashboard widgets — all in TypeScript.

## Structure

Extensions live in `.mercury/extensions/*/`. Each directory is an extension:

```
.mercury/extensions/
├── napkin/
│   ├── index.ts           # Required — setup function
│   ├── skill/SKILL.md     # Optional — agent skill
│   └── package.json       # Optional — dependencies
└── kb-distill/
    └── index.ts
```

The extension **name** is the directory name.

## Setup Function

Every extension exports a default function that receives the `MercuryExtensionAPI`:

```typescript
import type { MercuryExtensionAPI } from "mercury-ai";

export default function(mercury: MercuryExtensionAPI) {
  // Declare what this extension provides
  mercury.cli({ name: "napkin", install: "bun add -g napkin-ai" });
  mercury.permission({ defaultRoles: ["admin", "member"] });
  mercury.skill("./skill");

  mercury.on("workspace_init", async ({ workspace }) => {
    mkdirSync(join(workspace, "entities"), { recursive: true });
  });

  mercury.job("cleanup", {
    interval: 3600_000,
    run: async (ctx) => { /* ... */ },
  });

  mercury.config("enabled", {
    description: "Enable napkin for this group",
    default: "true",
  });

  mercury.widget({
    label: "Napkin Status",
    render: (ctx) => `<p>Last run: ${mercury.store.get("last-run") ?? "never"}</p>`,
  });
}
```

All declarations are optional — use only what you need.

## API Reference

### `mercury.cli(opts)`

Declare a CLI tool to install in the container image.

```typescript
mercury.cli({ name: "napkin", install: "bun add -g napkin-ai" });
```

- `name` — binary name (should match extension name)
- `install` — shell command run as a Dockerfile `RUN` step

Mercury auto-generates a derived Docker image with all extension CLIs installed. The agent invokes them via `mrctl <ext-name> <args>`.

Can only be called once per extension.

### `mercury.permission(opts)`

Register this extension's permission and set default roles.

```typescript
mercury.permission({ defaultRoles: ["admin", "member"] });
```

- Permission name = extension name (e.g., `napkin`)
- `defaultRoles` — roles that get this permission by default
- `admin` always gets all permissions automatically
- Per-group overrides in `group_config` take precedence

Can only be called once per extension.

### `mercury.skill(relativePath)`

Register a skill directory for agent discovery.

```typescript
mercury.skill("./skill");
```

The directory must contain a `SKILL.md` file in pi's [skill format](https://agentskills.io/specification). Mercury copies the entire skill directory into `.mercury/global/skills/<name>/`, which is mounted into containers at `/home/node/.pi/agent/skills/<name>/`. Pi discovers it automatically.

Skills can contain multiple files — scripts, references, assets — not just SKILL.md. The agent uses relative paths from SKILL.md to access them.

### `mercury.on(event, handler)`

Subscribe to lifecycle events.

```typescript
mercury.on("workspace_init", async (event, ctx) => {
  mkdirSync(join(event.workspace, "my-dir"), { recursive: true });
});
```

#### Events

| Event | When | Can mutate? |
|-------|------|-------------|
| `startup` | After extensions loaded, runtime ready | No |
| `shutdown` | Mercury shutting down | No |
| `workspace_init` | Group workspace created/ensured | No |
| `before_container` | About to spawn container | Yes |
| `after_container` | Container finished | Yes |

#### `before_container` mutations

```typescript
mercury.on("before_container", async (event, ctx) => {
  return {
    systemPrompt: "Extra instructions...",  // appended to system prompt
    env: { MY_VAR: "value" },               // extra container env vars
    block: { reason: "Rate limited" },       // prevent container from running
  };
});
```

#### `after_container` mutations

```typescript
mercury.on("after_container", async (event, ctx) => {
  return {
    reply: event.reply + "\n\n_Powered by Mercury_",  // transform reply
    suppress: true,                                     // don't send reply
  };
});
```

### `mercury.job(name, def)`

Register a background job that runs on the host.

```typescript
// Interval-based
mercury.job("cleanup", {
  interval: 3600_000,  // every hour
  run: async (ctx) => { /* ... */ },
});

// Cron-based
mercury.job("daily-report", {
  cron: "0 9 * * *",  // 9am daily
  run: async (ctx) => { /* ... */ },
});
```

Must specify either `interval` or `cron`, not both. Jobs are started after extensions load and stopped on shutdown. Errors are caught and logged — a failing job never crashes Mercury.

### `mercury.config(key, def)`

Register a per-group config key.

```typescript
mercury.config("enabled", {
  description: "Enable napkin for this group",
  default: "true",
  validate: (v) => v === "true" || v === "false",
});
```

Keys are namespaced to the extension: the above registers `napkin.enabled`. Users set it via `mrctl config set napkin.enabled false`.

### `mercury.widget(def)`

Register a dashboard widget.

```typescript
mercury.widget({
  label: "KB Distillation",
  render: (ctx) => {
    const lastRun = mercury.store.get("last-run") ?? "never";
    return `<div>Last run: ${lastRun}</div>`;
  },
});
```

Widgets render HTML fragments in the dashboard overview. Errors show a placeholder — never crash the dashboard.

### `mercury.store`

Scoped key-value store for persistent state.

```typescript
mercury.store.set("last-run", Date.now().toString());
mercury.store.get("last-run");     // "1709654400000"
mercury.store.delete("last-run");  // true
mercury.store.list();              // [{ key: "last-run", value: "..." }]
```

Each extension sees only its own keys. Backed by the `extension_state` SQLite table.

## Extension Context

Event handlers and job runners receive a `MercuryExtensionContext`:

```typescript
interface MercuryExtensionContext {
  readonly db: Db;          // Database access
  readonly config: AppConfig; // Mercury configuration
  readonly log: Logger;      // Logger scoped to the extension
}
```

## Container Integration

### Skill Files

Skills can include anything the agent needs:

```
napkin/skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts
│   └── search.js
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
└── assets/
    └── template.json
```

All files are copied into the container mount. Relative paths from SKILL.md work.

### Derived Image

Extensions that declare `mercury.cli()` get their tools installed in a derived Docker image:

```
FROM mercury-agent:latest
RUN bun add -g napkin-ai        # from napkin extension
RUN pip install some-tool       # from another extension
```

Mercury builds this image on startup (cached by content hash). If no extensions declare CLIs, the base image is used unchanged.

### Agent Discovery

The agent discovers extension CLIs via skills (SKILL.md files) and invokes them through `mrctl`:

```bash
mrctl napkin search "query"    # permission check → run napkin CLI
mrctl ext list                 # list installed extensions
```

## Built-in Commands vs Extensions

`mrctl` has two types of commands:

| Type | Examples | How it works |
|------|----------|--------------|
| **Built-in** | `tasks`, `roles`, `permissions`, `config`, `groups`, `stop`, `compact` | HTTP calls to host API |
| **Extension** | `napkin`, `kb-distill`, any custom | Permission check via API, then local CLI exec |

Built-in names are reserved — extension registration fails on collision.

## Permissions

One permission per extension, named after the extension. Extensions declare which roles get it by default:

```typescript
mercury.permission({ defaultRoles: ["admin", "member"] });
```

- `admin` always gets all permissions
- Per-group overrides via `mrctl permissions set <role> prompt,napkin,...`
- See [permissions.md](permissions.md) for the full RBAC system

## Types

All types are in `src/extensions/types.ts`:

- `MercuryExtensionAPI` — setup API surface
- `MercuryExtensionContext` — runtime context for hooks/jobs
- `MercuryEvents` — all lifecycle events
- `EventHandler<E>` / `EventResult<E>` — typed handlers with mutation support
- `ExtensionMeta` — collected metadata after setup
- `ExtensionStore` — scoped key-value store
- `JobDef`, `ConfigDef`, `WidgetDef`, `CliDef`, `PermissionDef` — definitions
- `ExtensionSetupFn` — the default export signature
