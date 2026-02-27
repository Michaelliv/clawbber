import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ALL_PERMISSIONS,
  getRolePermissions,
  hasPermission,
  isSystemCaller,
  resolveRole,
  seededGroups,
} from "../src/core/permissions.js";
import { Db } from "../src/storage/db.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bearclaw-test-"));
  db = new Db(path.join(tmpDir, "state.db"));
  db.ensureGroup("g1");
  seededGroups.clear();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isSystemCaller", () => {
  test("system is a system caller", () => {
    expect(isSystemCaller("system")).toBe(true);
  });

  test("regular user is not a system caller", () => {
    expect(isSystemCaller("whatsapp:123@s.whatsapp.net")).toBe(false);
  });

  test("admin is not a system caller", () => {
    expect(isSystemCaller("admin")).toBe(false);
  });
});

describe("getRolePermissions", () => {
  test("admin has all permissions by default", () => {
    const perms = getRolePermissions(db, "g1", "admin");
    for (const p of ALL_PERMISSIONS) {
      expect(perms.has(p)).toBe(true);
    }
  });

  test("member has only prompt by default", () => {
    const perms = getRolePermissions(db, "g1", "member");
    expect(perms.has("prompt")).toBe(true);
    expect(perms.has("stop")).toBe(false);
    expect(perms.has("config.set")).toBe(false);
  });

  test("system role has all permissions", () => {
    const perms = getRolePermissions(db, "g1", "system");
    for (const p of ALL_PERMISSIONS) {
      expect(perms.has(p)).toBe(true);
    }
  });

  test("unknown role has no permissions", () => {
    const perms = getRolePermissions(db, "g1", "moderator");
    expect(perms.size).toBe(0);
  });

  test("per-group override replaces defaults", () => {
    db.setGroupConfig(
      "g1",
      "role.member.permissions",
      "prompt,stop,compact",
      "system",
    );

    const perms = getRolePermissions(db, "g1", "member");
    expect(perms.has("prompt")).toBe(true);
    expect(perms.has("stop")).toBe(true);
    expect(perms.has("compact")).toBe(true);
    expect(perms.has("config.set")).toBe(false);
  });

  test("per-group override ignores invalid permissions", () => {
    db.setGroupConfig(
      "g1",
      "role.member.permissions",
      "prompt,invalid,stop",
      "system",
    );

    const perms = getRolePermissions(db, "g1", "member");
    expect(perms.has("prompt")).toBe(true);
    expect(perms.has("stop")).toBe(true);
    expect(perms.size).toBe(2);
  });

  test("custom role with per-group config", () => {
    db.setGroupConfig(
      "g1",
      "role.moderator.permissions",
      "prompt,stop,compact,tasks.list",
      "system",
    );

    const perms = getRolePermissions(db, "g1", "moderator");
    expect(perms.has("prompt")).toBe(true);
    expect(perms.has("stop")).toBe(true);
    expect(perms.has("compact")).toBe(true);
    expect(perms.has("tasks.list")).toBe(true);
    expect(perms.has("config.set")).toBe(false);
  });

  test("empty permissions string results in zero permissions", () => {
    db.setGroupConfig("g1", "role.member.permissions", "", "system");
    const perms = getRolePermissions(db, "g1", "member");
    expect(perms.size).toBe(0);
  });

  test("override for one group does not affect another", () => {
    db.ensureGroup("g2");
    db.setGroupConfig("g1", "role.member.permissions", "prompt,stop", "system");

    const g1perms = getRolePermissions(db, "g1", "member");
    const g2perms = getRolePermissions(db, "g2", "member");

    expect(g1perms.has("stop")).toBe(true);
    expect(g2perms.has("stop")).toBe(false);
  });
});

describe("hasPermission", () => {
  test("admin has prompt permission", () => {
    expect(hasPermission(db, "g1", "admin", "prompt")).toBe(true);
  });

  test("member does not have stop permission", () => {
    expect(hasPermission(db, "g1", "member", "stop")).toBe(false);
  });
});

describe("resolveRole", () => {
  test("system caller returns system role", () => {
    const role = resolveRole(db, "g1", "system", []);
    expect(role).toBe("system");
  });

  test("new user gets member role", () => {
    const role = resolveRole(db, "g1", "user1", []);
    expect(role).toBe("member");
  });

  test("seeded admin gets admin role", () => {
    const role = resolveRole(db, "g1", "user1", ["user1"]);
    expect(role).toBe("admin");
  });

  test("non-seeded user remains member even with admins seeded", () => {
    const role = resolveRole(db, "g1", "user2", ["user1"]);
    expect(role).toBe("member");
  });

  test("manually granted role persists", () => {
    db.setRole("g1", "user1", "moderator", "admin1");
    const role = resolveRole(db, "g1", "user1", []);
    expect(role).toBe("moderator");
  });

  test("seed does not downgrade existing admin", () => {
    db.setRole("g1", "user1", "admin", "manual");
    const role = resolveRole(db, "g1", "user1", ["user1"]);
    expect(role).toBe("admin");
  });

  test("resolveRole auto-upserts member", () => {
    resolveRole(db, "g1", "newuser", []);
    const dbRole = db.getRole("g1", "newuser");
    expect(dbRole).toBe("member");
  });
});
