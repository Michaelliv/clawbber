import type { Db } from "../storage/db.js";

export const ALL_PERMISSIONS = [
  "prompt",
  "stop",
  "compact",
  "tasks.list",
  "tasks.create",
  "tasks.pause",
  "tasks.resume",
  "tasks.delete",
  "config.get",
  "config.set",
  "roles.list",
  "roles.grant",
  "roles.revoke",
  "permissions.get",
  "permissions.set",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * Tracks which groups have had admins seeded to avoid redundant DB calls.
 * Exported for test isolation (tests should clear this in beforeEach).
 */
export const seededGroups = new Set<string>();

/**
 * System callers — these identities get full permissions without DB lookup.
 * Used for scheduled tasks, internal system calls, etc.
 */
const SYSTEM_CALLERS = new Set(["system"]);

export function isSystemCaller(callerId: string): boolean {
  return SYSTEM_CALLERS.has(callerId);
}

/** Built-in defaults — used when no per-group overrides exist */
const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  member: ["prompt"],
};

/**
 * Load the permission set for a role in a group.
 * Checks group_config for "role.<name>.permissions" override,
 * falls back to built-in defaults.
 */
export function getRolePermissions(
  db: Db,
  groupId: string,
  role: string,
): Set<Permission> {
  // System role always has full permissions — not configurable
  if (role === "system") return new Set(ALL_PERMISSIONS);

  const key = `role.${role}.permissions`;
  const stored = db.getGroupConfig(groupId, key);

  if (stored !== null) {
    const perms = stored
      .split(",")
      .map((s) => s.trim())
      .filter((s) => PERMISSION_SET.has(s));
    return new Set(perms as Permission[]);
  }

  const defaults = DEFAULT_ROLE_PERMISSIONS[role];
  if (defaults) return new Set(defaults);
  return new Set();
}

export function hasPermission(
  db: Db,
  groupId: string,
  role: string,
  permission: Permission,
): boolean {
  return getRolePermissions(db, groupId, role).has(permission);
}

export function resolveRole(
  db: Db,
  groupId: string,
  platformUserId: string,
  seededAdmins: string[],
): string {
  // System callers bypass DB entirely
  if (isSystemCaller(platformUserId)) return "system";

  if (seededAdmins.length > 0 && !seededGroups.has(groupId)) {
    db.seedAdmins(groupId, seededAdmins);
    seededGroups.add(groupId);
  }

  db.upsertMember(groupId, platformUserId);

  return db.getRole(groupId, platformUserId) ?? "member";
}
