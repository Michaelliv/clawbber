import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  Conversation,
  MessageAttachment,
  ScheduledTask,
  Space,
  SpaceConfigEntry,
  SpaceRole,
  StoredMessage,
} from "../types.js";

type SpaceRow = {
  id: string;
  name: string;
  tags: string | null;
  createdAt: number;
  updatedAt: number;
};

type ConversationRow = {
  id: number;
  platform: string;
  externalId: string;
  kind: string;
  observedTitle: string | null;
  spaceId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
};

type MessageRow = {
  id: number;
  spaceId: string;
  role: StoredMessage["role"];
  content: string;
  attachments: string | null;
  createdAt: number;
  updatedAt: number;
};

const SPACE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export class Db {
  private readonly db: Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'group',
        observed_title TEXT,
        space_id TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(platform, external_id),
        FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        attachments TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_space_created
      ON messages(space_id, created_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id TEXT NOT NULL,
        cron TEXT,
        at TEXT,
        prompt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        silent INTEGER NOT NULL DEFAULT 0,
        next_run_at INTEGER NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_next
      ON tasks(active, next_run_at);

      CREATE TABLE IF NOT EXISTS chat_state (
        space_id TEXT PRIMARY KEY,
        min_message_id INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS space_roles (
        space_id TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        granted_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (space_id, platform_user_id)
      );

      CREATE TABLE IF NOT EXISTS space_config (
        space_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (space_id, key)
      );

      CREATE TABLE IF NOT EXISTS extension_state (
        extension TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (extension, key)
      );

      CREATE TABLE IF NOT EXISTS mutes (
        space_id TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        reason TEXT,
        muted_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (space_id, platform_user_id)
      );
    `);
  }

  private assertValidSpaceId(spaceId: string): void {
    if (!SPACE_ID_RE.test(spaceId)) {
      throw new Error(
        `Invalid space id '${spaceId}'. Must match ${SPACE_ID_RE.toString()}`,
      );
    }
  }

  private parseMessageRow(row: MessageRow): StoredMessage {
    let attachments: MessageAttachment[] | undefined;
    if (row.attachments) {
      try {
        attachments = JSON.parse(row.attachments) as MessageAttachment[];
      } catch {
        attachments = undefined;
      }
    }
    return {
      id: row.id,
      spaceId: row.spaceId,
      role: row.role,
      content: row.content,
      attachments,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  createSpace(id: string, name: string, tags?: string): Space {
    this.assertValidSpaceId(id);
    const now = Date.now();

    const result = this.db
      .query(
        `INSERT OR IGNORE INTO spaces(id, name, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, name, tags ?? null, now, now);

    if (result.changes === 0) {
      throw new Error(`Space already exists: ${id}`);
    }

    const row = this.db
      .query(
        `SELECT id, name, tags, created_at as createdAt, updated_at as updatedAt
         FROM spaces WHERE id = ?`,
      )
      .get(id) as SpaceRow | null;

    if (!row) throw new Error(`Failed to load space ${id}`);
    return row;
  }

  ensureSpace(spaceId: string): Space {
    this.assertValidSpaceId(spaceId);
    const now = Date.now();

    this.db
      .query(
        `INSERT OR IGNORE INTO spaces(id, name, tags, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?)`,
      )
      .run(spaceId, spaceId, now, now);

    this.db
      .query("UPDATE spaces SET updated_at = ? WHERE id = ?")
      .run(now, spaceId);

    const row = this.db
      .query(
        `SELECT id, name, tags, created_at as createdAt, updated_at as updatedAt
         FROM spaces WHERE id = ?`,
      )
      .get(spaceId) as SpaceRow | null;

    if (!row) throw new Error(`Failed to load space ${spaceId}`);
    return row;
  }

  listSpaces(): Space[] {
    return this.db
      .query(
        `SELECT id, name, tags, created_at as createdAt, updated_at as updatedAt
         FROM spaces ORDER BY created_at ASC`,
      )
      .all() as Space[];
  }

  getSpace(spaceId: string): Space | null {
    return this.db
      .query(
        `SELECT id, name, tags, created_at as createdAt, updated_at as updatedAt
         FROM spaces WHERE id = ?`,
      )
      .get(spaceId) as Space | null;
  }

  updateSpaceName(spaceId: string, name: string): boolean {
    const now = Date.now();
    const result = this.db
      .query("UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, now, spaceId);
    return result.changes > 0;
  }

  deleteSpace(spaceId: string): {
    deleted: boolean;
    removed: {
      space: number;
      messages: number;
      tasks: number;
      chatState: number;
      roles: number;
      config: number;
      conversationsUnlinked: number;
    };
  } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const messages = this.db
        .query("DELETE FROM messages WHERE space_id = ?")
        .run(spaceId).changes;
      const tasks = this.db
        .query("DELETE FROM tasks WHERE space_id = ?")
        .run(spaceId).changes;
      const chatState = this.db
        .query("DELETE FROM chat_state WHERE space_id = ?")
        .run(spaceId).changes;
      const roles = this.db
        .query("DELETE FROM space_roles WHERE space_id = ?")
        .run(spaceId).changes;
      const config = this.db
        .query("DELETE FROM space_config WHERE space_id = ?")
        .run(spaceId).changes;
      const conversationsUnlinked = this.db
        .query("SELECT COUNT(*) as count FROM conversations WHERE space_id = ?")
        .get(spaceId) as { count: number };
      const space = this.db
        .query("DELETE FROM spaces WHERE id = ?")
        .run(spaceId).changes;

      this.db.exec("COMMIT");

      return {
        deleted: space > 0,
        removed: {
          space,
          messages,
          tasks,
          chatState,
          roles,
          config,
          conversationsUnlinked: Number(conversationsUnlinked?.count ?? 0),
        },
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  ensureConversation(
    platform: string,
    externalId: string,
    kind: string,
    observedTitle?: string,
  ): Conversation {
    const now = Date.now();

    this.db
      .query(
        `INSERT OR IGNORE INTO conversations(
          platform, external_id, kind, observed_title, space_id, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(platform, externalId, kind, observedTitle ?? null, now, now);

    if (observedTitle?.trim()) {
      this.db
        .query(
          `UPDATE conversations
           SET kind = ?,
               observed_title = ?,
               last_seen_at = ?
           WHERE platform = ? AND external_id = ?`,
        )
        .run(kind, observedTitle, now, platform, externalId);
    } else {
      this.db
        .query(
          `UPDATE conversations
           SET kind = ?, last_seen_at = ?
           WHERE platform = ? AND external_id = ?`,
        )
        .run(kind, now, platform, externalId);
    }

    const row = this.db
      .query(
        `SELECT
           id,
           platform,
           external_id as externalId,
           kind,
           observed_title as observedTitle,
           space_id as spaceId,
           first_seen_at as firstSeenAt,
           last_seen_at as lastSeenAt
         FROM conversations
         WHERE platform = ? AND external_id = ?`,
      )
      .get(platform, externalId) as ConversationRow | null;

    if (!row) {
      throw new Error(`Failed to load conversation ${platform}:${externalId}`);
    }

    return row;
  }

  findConversation(platform: string, externalId: string): Conversation | null {
    return this.db
      .query(
        `SELECT
           id,
           platform,
           external_id as externalId,
           kind,
           observed_title as observedTitle,
           space_id as spaceId,
           first_seen_at as firstSeenAt,
           last_seen_at as lastSeenAt
         FROM conversations
         WHERE platform = ? AND external_id = ?`,
      )
      .get(platform, externalId) as Conversation | null;
  }

  listConversations(filter?: {
    linked?: boolean;
    platform?: string;
  }): Conversation[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (filter?.linked === true) {
      where.push("space_id IS NOT NULL");
    } else if (filter?.linked === false) {
      where.push("space_id IS NULL");
    }

    if (filter?.platform) {
      where.push("platform = ?");
      params.push(filter.platform);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    return this.db
      .query(
        `SELECT
           id,
           platform,
           external_id as externalId,
           kind,
           observed_title as observedTitle,
           space_id as spaceId,
           first_seen_at as firstSeenAt,
           last_seen_at as lastSeenAt
         FROM conversations
         ${whereSql}
         ORDER BY last_seen_at DESC, id DESC`,
      )
      .all(...params) as Conversation[];
  }

  linkConversation(conversationId: number, spaceId: string): boolean {
    const result = this.db
      .query(
        `UPDATE conversations
         SET space_id = ?, last_seen_at = ?
         WHERE id = ?`,
      )
      .run(spaceId, Date.now(), conversationId);
    return result.changes > 0;
  }

  unlinkConversation(conversationId: number): boolean {
    const result = this.db
      .query(
        `UPDATE conversations
         SET space_id = NULL, last_seen_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), conversationId);
    return result.changes > 0;
  }

  getSpaceConversations(spaceId: string): Conversation[] {
    return this.db
      .query(
        `SELECT
           id,
           platform,
           external_id as externalId,
           kind,
           observed_title as observedTitle,
           space_id as spaceId,
           first_seen_at as firstSeenAt,
           last_seen_at as lastSeenAt
         FROM conversations
         WHERE space_id = ?
         ORDER BY last_seen_at DESC, id DESC`,
      )
      .all(spaceId) as Conversation[];
  }

  updateConversationTitle(conversationId: number, title: string): void {
    this.db
      .query(
        `UPDATE conversations
         SET observed_title = ?, last_seen_at = ?
         WHERE id = ?`,
      )
      .run(title, Date.now(), conversationId);
  }

  addMessage(
    spaceId: string,
    role: StoredMessage["role"],
    content: string,
    attachments?: MessageAttachment[],
  ): void {
    const now = Date.now();
    const attachmentsJson =
      attachments && attachments.length > 0
        ? JSON.stringify(attachments)
        : null;
    this.db
      .query(
        `INSERT INTO messages(space_id, role, content, attachments, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(spaceId, role, content, attachmentsJson, now, now);
  }

  clearMessages(spaceId: string): void {
    this.db.query("DELETE FROM messages WHERE space_id = ?").run(spaceId);
  }

  private getSessionBoundary(spaceId: string): number {
    const row = this.db
      .query(
        `SELECT min_message_id as minMessageId
         FROM chat_state
         WHERE space_id = ?`,
      )
      .get(spaceId) as { minMessageId: number } | null;
    return row?.minMessageId ?? 0;
  }

  setSessionBoundaryToLatest(spaceId: string): number {
    const row = this.db
      .query(
        `SELECT COALESCE(MAX(id), 0) as id
         FROM messages
         WHERE space_id = ?`,
      )
      .get(spaceId) as { id: number } | null;
    const minMessageId = Number(row?.id ?? 0);

    const now = Date.now();
    this.db
      .query(
        `INSERT INTO chat_state(space_id, min_message_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(space_id)
         DO UPDATE SET min_message_id = excluded.min_message_id, updated_at = excluded.updated_at`,
      )
      .run(spaceId, minMessageId, now, now);

    return minMessageId;
  }

  getRecentMessages(spaceId: string, limit = 40): StoredMessage[] {
    const boundary = this.getSessionBoundary(spaceId);
    const rows = this.db
      .query(
        `SELECT
           id,
           space_id as spaceId,
           role,
           content,
           attachments,
           created_at as createdAt,
           updated_at as updatedAt
         FROM messages
         WHERE space_id = ? AND id > ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(spaceId, boundary, limit) as MessageRow[];
    return rows.reverse().map((row) => this.parseMessageRow(row));
  }

  getMessagesSinceLastUserTrigger(
    spaceId: string,
    limit = 200,
  ): StoredMessage[] {
    const boundary = this.getSessionBoundary(spaceId);

    const latestUser = this.db
      .query(
        `SELECT id
         FROM messages
         WHERE space_id = ? AND role = 'user' AND id > ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(spaceId, boundary) as { id: number } | null;

    if (!latestUser) return [];

    const previousUser = this.db
      .query(
        `SELECT id
         FROM messages
         WHERE space_id = ? AND role = 'user' AND id > ? AND id < ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(spaceId, boundary, latestUser.id) as { id: number } | null;

    const afterId = previousUser?.id ?? boundary;

    const rows = this.db
      .query(
        `SELECT
           id,
           space_id as spaceId,
           role,
           content,
           attachments,
           created_at as createdAt,
           updated_at as updatedAt
         FROM messages
         WHERE space_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(spaceId, afterId, limit) as MessageRow[];
    return rows.map((row) => this.parseMessageRow(row));
  }

  createTask(
    spaceId: string,
    schedule: { cron: string } | { at: string },
    prompt: string,
    nextRunAt: number,
    createdBy: string,
    silent = false,
  ): number {
    const now = Date.now();
    const cron = "cron" in schedule ? schedule.cron : null;
    const at = "at" in schedule ? schedule.at : null;
    this.db
      .query(
        `INSERT INTO tasks(space_id, cron, at, prompt, active, silent, next_run_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        spaceId,
        cron,
        at,
        prompt,
        silent ? 1 : 0,
        nextRunAt,
        createdBy,
        now,
        now,
      );

    const row = this.db.query("SELECT last_insert_rowid() as id").get() as {
      id: number;
    } | null;
    if (!row) throw new Error("Failed to read task id");
    return Number(row.id);
  }

  listTasks(spaceId?: string): ScheduledTask[] {
    if (spaceId) {
      return this.db
        .query(
          `SELECT
             id,
             space_id as spaceId,
             cron,
             at,
             prompt,
             active,
             silent,
             next_run_at as nextRunAt,
             created_by as createdBy,
             created_at as createdAt,
             updated_at as updatedAt
           FROM tasks
           WHERE space_id = ?
           ORDER BY id ASC`,
        )
        .all(spaceId) as ScheduledTask[];
    }

    return this.db
      .query(
        `SELECT
           id,
           space_id as spaceId,
           cron,
           at,
           prompt,
           active,
           silent,
           next_run_at as nextRunAt,
           created_by as createdBy,
           created_at as createdAt,
           updated_at as updatedAt
         FROM tasks
         ORDER BY id ASC`,
      )
      .all() as ScheduledTask[];
  }

  getDueTasks(now = Date.now()): ScheduledTask[] {
    return this.db
      .query(
        `SELECT
           id,
           space_id as spaceId,
           cron,
           at,
           prompt,
           active,
           silent,
           next_run_at as nextRunAt,
           created_by as createdBy,
           created_at as createdAt,
           updated_at as updatedAt
         FROM tasks
         WHERE active = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now) as ScheduledTask[];
  }

  updateTaskNextRun(id: number, nextRunAt: number): void {
    this.db
      .query("UPDATE tasks SET next_run_at = ?, updated_at = ? WHERE id = ?")
      .run(nextRunAt, Date.now(), id);
  }

  setTaskActive(id: number, active: boolean): void {
    this.db
      .query("UPDATE tasks SET active = ?, updated_at = ? WHERE id = ?")
      .run(active ? 1 : 0, Date.now(), id);
  }

  deleteTask(id: number, spaceId: string): boolean {
    const result = this.db
      .query("DELETE FROM tasks WHERE id = ? AND space_id = ?")
      .run(id, spaceId);
    return result.changes > 0;
  }

  deleteTaskById(id: number): boolean {
    const result = this.db.query("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getTask(id: number): ScheduledTask | null {
    return this.db
      .query(
        `SELECT
           id,
           space_id as spaceId,
           cron,
           at,
           prompt,
           active,
           silent,
           next_run_at as nextRunAt,
           created_by as createdBy,
           created_at as createdAt,
           updated_at as updatedAt
         FROM tasks
         WHERE id = ?`,
      )
      .get(id) as ScheduledTask | null;
  }

  // --- Roles ---

  upsertMember(spaceId: string, platformUserId: string): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT OR IGNORE INTO space_roles(space_id, platform_user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, 'member', NULL, ?, ?)`,
      )
      .run(spaceId, platformUserId, now, now);
  }

  setRole(
    spaceId: string,
    platformUserId: string,
    role: string,
    grantedBy: string,
  ): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO space_roles(space_id, platform_user_id, role, granted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, platform_user_id)
         DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, updated_at = excluded.updated_at`,
      )
      .run(spaceId, platformUserId, role, grantedBy, now, now);
  }

  getRole(spaceId: string, platformUserId: string): string | null {
    const row = this.db
      .query(
        `SELECT role FROM space_roles
         WHERE space_id = ? AND platform_user_id = ?`,
      )
      .get(spaceId, platformUserId) as { role: string } | null;
    return row?.role ?? null;
  }

  listRoles(spaceId: string): SpaceRole[] {
    return this.db
      .query(
        `SELECT
           space_id as spaceId,
           platform_user_id as platformUserId,
           role,
           granted_by as grantedBy,
           created_at as createdAt,
           updated_at as updatedAt
         FROM space_roles
         WHERE space_id = ?
         ORDER BY created_at ASC`,
      )
      .all(spaceId) as SpaceRole[];
  }

  deleteRole(spaceId: string, platformUserId: string): boolean {
    const result = this.db
      .query(
        `DELETE FROM space_roles
         WHERE space_id = ? AND platform_user_id = ?`,
      )
      .run(spaceId, platformUserId);
    return result.changes > 0;
  }

  seedAdmins(spaceId: string, adminIds: string[]): void {
    const now = Date.now();
    for (const id of adminIds) {
      this.db
        .query(
          `INSERT INTO space_roles(space_id, platform_user_id, role, granted_by, created_at, updated_at)
           VALUES (?, ?, 'admin', 'seed', ?, ?)
           ON CONFLICT(space_id, platform_user_id)
           DO UPDATE SET role = 'admin', granted_by = 'seed', updated_at = excluded.updated_at
           WHERE space_roles.role != 'admin'`,
        )
        .run(spaceId, id, now, now);
    }
  }

  // --- Space Config ---

  getSpaceConfig(spaceId: string, key: string): string | null {
    const row = this.db
      .query("SELECT value FROM space_config WHERE space_id = ? AND key = ?")
      .get(spaceId, key) as { value: string } | null;
    return row?.value ?? null;
  }

  setSpaceConfig(
    spaceId: string,
    key: string,
    value: string,
    updatedBy: string,
  ): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO space_config(space_id, key, value, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, key)
         DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(spaceId, key, value, updatedBy, now, now);
  }

  listSpaceConfig(spaceId: string): SpaceConfigEntry[] {
    return this.db
      .query(
        `SELECT
           space_id as spaceId,
           key,
           value,
           updated_by as updatedBy,
           created_at as createdAt,
           updated_at as updatedAt
         FROM space_config
         WHERE space_id = ?
         ORDER BY key ASC`,
      )
      .all(spaceId) as SpaceConfigEntry[];
  }

  // --- Extension State ---

  getExtState(extension: string, key: string): string | null {
    const row = this.db
      .query(
        "SELECT value FROM extension_state WHERE extension = ? AND key = ?",
      )
      .get(extension, key) as { value: string } | null;
    return row?.value ?? null;
  }

  setExtState(extension: string, key: string, value: string): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO extension_state(extension, key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(extension, key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(extension, key, value, now, now);
  }

  deleteExtState(extension: string, key: string): boolean {
    const result = this.db
      .query("DELETE FROM extension_state WHERE extension = ? AND key = ?")
      .run(extension, key);
    return result.changes > 0;
  }

  listExtState(extension: string): Array<{ key: string; value: string }> {
    return this.db
      .query(
        "SELECT key, value FROM extension_state WHERE extension = ? ORDER BY key ASC",
      )
      .all(extension) as Array<{ key: string; value: string }>;
  }

  // ─── Mutes ─────────────────────────────────────────────────────────────

  muteUser(
    spaceId: string,
    platformUserId: string,
    expiresAt: number,
    mutedBy: string,
    reason?: string,
  ): void {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO mutes (space_id, platform_user_id, expires_at, reason, muted_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, platform_user_id) DO UPDATE SET
           expires_at = excluded.expires_at,
           reason = excluded.reason,
           muted_by = excluded.muted_by`,
      )
      .run(spaceId, platformUserId, expiresAt, reason ?? null, mutedBy, now);
  }

  unmuteUser(spaceId: string, platformUserId: string): boolean {
    const result = this.db
      .query("DELETE FROM mutes WHERE space_id = ? AND platform_user_id = ?")
      .run(spaceId, platformUserId);
    return result.changes > 0;
  }

  isMuted(spaceId: string, platformUserId: string): boolean {
    const now = Date.now();
    // Clean up expired mute and return false
    const row = this.db
      .query(
        "SELECT expires_at FROM mutes WHERE space_id = ? AND platform_user_id = ?",
      )
      .get(spaceId, platformUserId) as { expires_at: number } | null;

    if (!row) return false;
    if (row.expires_at <= now) {
      this.unmuteUser(spaceId, platformUserId);
      return false;
    }
    return true;
  }

  getMute(
    spaceId: string,
    platformUserId: string,
  ): {
    platformUserId: string;
    expiresAt: number;
    reason: string | null;
    mutedBy: string;
  } | null {
    const now = Date.now();
    const row = this.db
      .query(
        `SELECT platform_user_id, expires_at, reason, muted_by
         FROM mutes WHERE space_id = ? AND platform_user_id = ? AND expires_at > ?`,
      )
      .get(spaceId, platformUserId, now) as {
      platform_user_id: string;
      expires_at: number;
      reason: string | null;
      muted_by: string;
    } | null;

    if (!row) return null;
    return {
      platformUserId: row.platform_user_id,
      expiresAt: row.expires_at,
      reason: row.reason,
      mutedBy: row.muted_by,
    };
  }

  listMutes(
    spaceId: string,
  ): Array<{
    platformUserId: string;
    expiresAt: number;
    reason: string | null;
    mutedBy: string;
  }> {
    const now = Date.now();
    // Clean expired
    this.db
      .query("DELETE FROM mutes WHERE space_id = ? AND expires_at <= ?")
      .run(spaceId, now);

    return (
      this.db
        .query(
          `SELECT platform_user_id, expires_at, reason, muted_by
         FROM mutes WHERE space_id = ? ORDER BY expires_at ASC`,
        )
        .all(spaceId) as Array<{
        platform_user_id: string;
        expires_at: number;
        reason: string | null;
        muted_by: string;
      }>
    ).map((r) => ({
      platformUserId: r.platform_user_id,
      expiresAt: r.expires_at,
      reason: r.reason,
      mutedBy: r.muted_by,
    }));
  }

  close(): void {
    this.db.close();
  }
}
