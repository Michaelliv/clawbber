# Extensions

Mercury's extension system lets you add CLIs, skills, background jobs, lifecycle hooks, config keys, and dashboard widgets — all in TypeScript.

## Structure

Extensions live in `extensions/*/`:

```
extensions/
├── knowledge/
│   ├── index.ts           # Required — setup function
│   ├── skill/SKILL.md     # Optional — agent skill
│   └── package.json       # Optional — dependencies
└── charts/
    └── index.ts
```

The extension **name** is the directory name.

## Setup Function

Every extension exports a default function:

```typescript
import type { MercuryExtensionAPI } from "mercury-ai";

export default function(mercury: MercuryExtensionAPI) {
  mercury.cli({ name: "napkin", install: "bun add -g napkin-ai" });
  mercury.permission({ defaultRoles: ["admin", "member"] });
  mercury.skill("./skill");
  mercury.env({ from: "MERCURY_NAPKIN_API_KEY" });

  mercury.on("workspace_init", async ({ workspace }) => {
    mkdirSync(join(workspace, "entities"), { recursive: true });
  });

  mercury.job("distill", {
    interval: 3600_000,
    run: async (ctx) => { /* ... */ },
  });

  mercury.config("enabled", {
    description: "Enable this extension",
    default: "true",
  });

  mercury.widget({
    label: "Status",
    render: (ctx) => `<p>Last run: ${mercury.store.get("last-run") ?? "never"}</p>`,
  });
}
```

## API Reference

### `mercury.cli(opts)`

Declare a CLI tool to install in the Docker image.

```typescript
mercury.cli({ name: "napkin", install: "bun add -g napkin-ai" });
```

`mercury build` injects these as `RUN` steps in the Dockerfile. The agent calls them directly in bash. Permission enforcement is handled by the permission guard pi extension which blocks denied CLIs based on `MERCURY_DENIED_CLIS`.

### `mercury.permission(opts)`

Register this extension's RBAC permission.

```typescript
mercury.permission({ defaultRoles: ["admin", "member"] });
```

- Permission name = extension name
- `admin` always gets all permissions
- Overridable via `mrctl permissions set <role> <perms...>`

### `mercury.env(def)`

Declare an environment variable. Only injected into the agent subprocess when the caller has permission for this extension.

```typescript
mercury.env({ from: "MERCURY_GH_TOKEN" });                     // injected as GH_TOKEN
mercury.env({ from: "MERCURY_GH_TOKEN", as: "GITHUB_TOKEN" }); // custom name
```

Claimed vars are excluded from the blind `MERCURY_*` passthrough, preventing credential leakage to unprivileged callers.

### `mercury.skill(relativePath)`

Register a skill directory for agent discovery.

```typescript
mercury.skill("./skill");
```

Must contain `SKILL.md` in pi's [skill format](https://agentskills.io/specification). Mercury copies the directory into the workspace's `.pi/skills/<name>/`.

### `mercury.on(event, handler)`

Subscribe to lifecycle events.

| Event | When | Can mutate? |
|-------|------|-------------|
| `startup` | After extensions loaded | No |
| `shutdown` | Mercury shutting down | No |
| `workspace_init` | Workspace ensured | No |
| `before_container` | About to run agent | Yes — env, systemPrompt, block |
| `after_container` | Agent finished | Yes — reply, suppress |

#### `before_container` mutations

```typescript
mercury.on("before_container", async (event, ctx) => {
  return {
    systemPrompt: "Extra instructions...",
    env: { MY_VAR: "value" },
    block: { reason: "Rate limited" },
  };
});
```

#### `after_container` mutations

```typescript
mercury.on("after_container", async (event, ctx) => {
  return {
    reply: event.reply + "\n\n_Powered by Mercury_",
    suppress: true,
  };
});
```

### `mercury.job(name, def)`

Register a background job.

```typescript
mercury.job("cleanup", { interval: 3600_000, run: async (ctx) => { /* ... */ } });
mercury.job("report", { cron: "0 9 * * *", run: async (ctx) => { /* ... */ } });
```

### `mercury.config(key, def)`

Register a config key (namespaced to the extension).

```typescript
mercury.config("enabled", { description: "Enable this extension", default: "true" });
// Users set via: mrctl config set <extension>.enabled false
```

### `mercury.widget(def)`

Register a dashboard widget.

```typescript
mercury.widget({ label: "Status", render: (ctx) => "<p>OK</p>" });
```

### `mercury.store`

Scoped key-value store for persistent state.

```typescript
mercury.store.set("last-run", Date.now().toString());
mercury.store.get("last-run");
mercury.store.delete("last-run");
mercury.store.list();
```

Each extension sees only its own keys. Backed by the `extension_state` SQLite table.

## Installation

```bash
mercury ext add ./path/to/extension         # local
mercury ext add npm:mercury-ext-napkin      # npm
mercury ext add git:github.com/user/ext     # git
mercury ext remove <name>
mercury ext list
```

After adding/removing extensions, run `mercury restart` (rebuilds image + restarts).

## Built-in vs Extension Commands

| Type | Examples | Mechanism |
|------|----------|-----------|
| **Built-in** | tasks, roles, config, mutes, stop, compact | mrctl → HTTP API |
| **Extension** | napkin, gh, mmdc | Direct bash, RBAC via permission guard |

Built-in names are reserved — extensions cannot collide.

## Types

All types in `src/extensions/types.ts`: `MercuryExtensionAPI`, `MercuryExtensionContext`, `MercuryEvents`, `ExtensionMeta`, `ExtensionStore`, `JobDef`, `ConfigDef`, `WidgetDef`, `CliDef`, `PermissionDef`.
