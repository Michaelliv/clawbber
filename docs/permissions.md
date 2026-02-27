# Permissions

Mercury uses role-based access control (RBAC) per group. Each user has a role, and each role has a set of permissions.

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
  │     • Check group_config for override
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
| `admin` | All | Full control over the group |
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
| `config.get` | Read group configuration |
| `config.set` | Modify group configuration |
| `roles.list` | View roles in the group |
| `roles.grant` | Assign roles to users |
| `roles.revoke` | Remove roles from users |
| `permissions.get` | View role permissions |
| `permissions.set` | Modify role permissions |

## Managing Roles

The agent uses `mercury-ctl` to manage roles:

```bash
# List all roles in the current group
mercury-ctl roles list

# Grant admin role to a user
mercury-ctl roles grant 1234567890@s.whatsapp.net --role admin

# Grant a custom role
mercury-ctl roles grant 1234567890@s.whatsapp.net --role moderator

# Revoke role (user becomes member)
mercury-ctl roles revoke 1234567890@s.whatsapp.net
```

## Managing Permissions

Permissions are per-role, per-group:

```bash
# Show permissions for all roles
mercury-ctl permissions show

# Show permissions for a specific role
mercury-ctl permissions show --role member

# Give members ability to stop the agent
mercury-ctl permissions set member prompt,stop

# Create a moderator role with task management
mercury-ctl permissions set moderator prompt,stop,tasks.list,tasks.pause,tasks.resume

# Give a role full task control
mercury-ctl permissions set taskmaster prompt,tasks.list,tasks.create,tasks.pause,tasks.resume,tasks.delete
```

## Seeding Admins

Pre-configure admin users via environment variable. They're granted admin on first interaction with each group:

```bash
MERCURY_ADMINS=1234567890@s.whatsapp.net,0987654321@s.whatsapp.net
```

This is useful for bootstrapping — the first admin can then grant roles to others.

## Storage

Roles and permissions are stored in SQLite:

| Table | Purpose |
|-------|---------|
| `group_roles` | Maps `(group_id, platform_user_id)` → `role` |
| `group_config` | Stores `role.<name>.permissions` overrides |

Built-in defaults (`admin` = all, `member` = prompt) are not stored — they're applied when no override exists.

## System Caller

The `system` role is special:

- Always has all permissions
- Cannot be modified or assigned
- Used for internal callers: scheduled tasks, system triggers

```typescript
if (isSystemCaller(callerId)) return "system";
```

## Scope

Permissions are **per-group**:

- A user can be `admin` in one group and `member` in another
- Custom role permissions are group-specific
- No global roles (except seeded admins, which apply on first interaction per group)

## API

### `resolveRole(db, groupId, platformUserId, seededAdmins)`

Determines a caller's role:
1. System caller → `"system"`
2. Seed admins if needed
3. Upsert member record
4. Return stored role or `"member"`

### `getRolePermissions(db, groupId, role)`

Returns the permission set for a role:
1. System role → all permissions
2. Check `group_config` for `role.<name>.permissions`
3. Fall back to built-in defaults

### `hasPermission(db, groupId, role, permission)`

Returns `true` if the role has the specified permission.
