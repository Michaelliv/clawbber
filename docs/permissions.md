# Permissions

Per-space RBAC: roles, permission sets, extension permissions, and admin seeding.

Mercury uses role-based access control (RBAC) per space. Each user has a role, and each role has a set of permissions.

## How It Works

```
Message arrives
  │
  ├─► Resolve caller's role
  │     • System caller? → role = "system"
  │     • Seeded admin? → grant admin, store in DB
  │     • Existing role in DB? → use it
  │     • Otherwise → "member"
  │
  ├─► Load role's permissions
  │     • Check space_config for override
  │     • Fall back to built-in defaults
  │
  └─► Check permission for action
        • Has permission → proceed
        • Denied → return error
```

## Roles

| Role | Default Permissions | Description |
|------|---------------------|-------------|
| `system` | All | Internal system caller (scheduler, etc.) — not assignable |
| `admin` | All | Full control over the space |
| `member` | `prompt` | Can chat with the assistant (default for new users) |

Custom roles can be created by assigning permissions to any role name.

## Permissions

| Permission | Description |
|------------|-------------|
| `prompt` | Send messages to the assistant |
| `stop` | Abort running agent and clear queue |
| `compact` | Reset session boundary (fresh context) |
| `tasks.list` | View scheduled tasks |
| `tasks.create` | Create new scheduled tasks |
| `tasks.pause` | Pause scheduled tasks |
| `tasks.resume` | Resume paused tasks |
| `tasks.delete` | Delete scheduled tasks |
| `config.get` | Read space configuration |
| `config.set` | Modify space configuration |
| `roles.list` | View roles in the space |
| `roles.grant` | Assign roles to users |
| `roles.revoke` | Remove roles from users |
| `permissions.get` | View role permissions |
| `permissions.set` | Modify role permissions |
| `spaces.list` | View all spaces |
| `spaces.rename` | Rename a space and link/unlink conversations |
| `spaces.delete` | Delete current space and all related DB data |

## Managing Roles

The agent uses `mrctl` to manage roles:

```bash
# List all roles in the current space
mrctl roles list

# Grant admin role to a user
mrctl roles grant 1234567890@s.whatsapp.net --role admin

# Grant a custom role
mrctl roles grant 1234567890@s.whatsapp.net --role moderator

# Revoke role (user becomes member)
mrctl roles revoke 1234567890@s.whatsapp.net
```

## Managing Permissions

Permissions are per-role, per-space:

```bash
# Show permissions for all roles
mrctl permissions show

# Show permissions for a specific role
mrctl permissions show --role member

# Give members ability to stop the agent
mrctl permissions set member prompt,stop

# Create a moderator role with task management
mrctl permissions set moderator prompt,stop,tasks.list,tasks.pause,tasks.resume

# Give a role full task control
mrctl permissions set taskmaster prompt,tasks.list,tasks.create,tasks.pause,tasks.resume,tasks.delete
```

## Managing Spaces

Spaces can be listed and managed via `mrctl`:

```bash
# List all spaces with their names
mrctl spaces list

# Get current space's display name
mrctl spaces name

# Set current space's display name
mrctl spaces name "Startup Buddies"

# Delete current space (tasks, messages, roles, config)
mrctl spaces delete

# List discovered conversations
mrctl conversations list

# Show only conversations that are not yet linked
mrctl conversations list --unlinked
```

Space names are stored in the database and shown in logs/dashboard for easier identification. Conversations remain platform-native and are linked into spaces. Conversation listing uses `spaces.list`; linking and unlinking use `spaces.rename`.

## Seeding Admins

Pre-configure admin users via environment variable. They're granted admin on first interaction with each space:

```bash
MERCURY_ADMINS=1234567890@s.whatsapp.net,0987654321@s.whatsapp.net
```

This is useful for bootstrapping — the first admin can then grant roles to others.

## Storage

Roles and permissions are stored in SQLite:

| Table | Purpose |
|-------|---------|
| `space_roles` | Maps `(space_id, platform_user_id)` → `role` |
| `space_config` | Stores `role.<name>.permissions` overrides |

Built-in defaults (`admin` = all, `member` = prompt) are not stored — they're applied when no override exists.

## System Caller

The `system` role is special:

- Always has all permissions
- Cannot be modified or assigned
- Used for internal callers: scheduled tasks, system triggers

```typescript
if (isSystemCaller(callerId)) return "system";
```

## Extension Permissions

Extensions register additional permissions at runtime via the extension API:

```typescript
mercury.permission({ defaultRoles: ["admin", "member"] });
```

This registers a permission named after the extension (e.g., `napkin`). The behavior:

- **Admin** always gets all permissions (built-in + extension)
- **Extension `defaultRoles`** are respected — if `["member"]` is specified, members get that permission by default
- **Per-space overrides** still take precedence over defaults
- **Built-in permission names** cannot be overridden by extensions

Extension CLIs are called directly by the agent in bash. Permission enforcement is handled by a pi extension that blocks denied CLIs at the bash tool level, based on the caller's role and the `MERCURY_DENIED_CLIS` environment variable set by Mercury's runtime.

Extensions that declare env vars via `mercury.env()` also have those vars gated by permission — they are only injected into containers when the caller has the extension's permission. This prevents credential leakage (e.g., a blocked `gh` CLI's `GH_TOKEN` being used via `curl`).

### API

```typescript
registerPermission(name, { defaultRoles })   // Register (called by extension loader)
getAllPermissions()                            // Built-in + extension permissions
isValidPermission(name)                       // Check if name is valid
resetPermissions()                            // Clear registered (test isolation)
```

## Scope

Permissions are **per-space**:

- A user can be `admin` in one space and `member` in another
- Custom role permissions are space-specific
- No global roles (except seeded admins, which apply on first interaction per space)

## API

### `resolveRole(db, spaceId, platformUserId, seededAdmins)`

Determines a caller's role:
1. System caller → `"system"`
2. Seed admins if needed
3. Upsert member record
4. Return stored role or `"member"`

### `getRolePermissions(db, spaceId, role)`

Returns the permission set for a role:
1. System role → all permissions
2. Check `space_config` for `role.<name>.permissions`
3. Fall back to built-in defaults

### `hasPermission(db, spaceId, role, permission)`

Returns `true` if the role has the specified permission.
