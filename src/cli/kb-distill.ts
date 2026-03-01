#!/usr/bin/env bun

/**
 * KB Distillation CLI
 *
 * Exports messages to daily JSONL files and runs kb-distiller on them.
 *
 * Usage:
 *   mercury kb-distill              # Process today's messages
 *   mercury kb-distill --backfill   # Process all historical messages
 */

import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";

const KB_DISTILLER_PROMPT = `You are a KB distillation agent. Extract lasting knowledge from conversations and save to an Obsidian vault.

## Input

You receive a path to a JSONL file. Each line is:
\`\`\`json
{"ts":1709123456,"role":"ambient|user|assistant","content":"..."}
\`\`\`

**Roles:**
- \`ambient\` = Group chat message. Format: \`Name: message content\`
- \`user\` = Message that triggered the assistant
- \`assistant\` = Assistant's response

## Vault

Current directory is the vault. Use \`--vault .\` with napkin.

## Incremental Updates

Check before creating:
1. \`napkin search --vault . "name"\`
2. Exists → \`napkin append\`
3. New → \`napkin create\`

## Extract

### PEOPLE (3+ messages OR shared resource OR clear position)
\`\`\`markdown
# [Person Name]

## Expertise
- [topics]

## Positions
- [opinions]

## Resources Shared
- [[resource]]
\`\`\`

### RESOURCES (tools, repos, URLs)
\`\`\`markdown
# [Resource Name]

Type: tool | repo | article
URL: [if shared]
Shared by: [[person]] on [date]

## What it does
## Why shared
\`\`\`

### GROUP KNOWLEDGE (decisions only)
\`\`\`markdown
# [Topic]

Date: [date]
Participants: [[person-a]], [[person-b]]

## Question
## Conclusion
\`\`\`

## Skip

- Thin interactions
- Encyclopedia definitions  
- Transient chatter
- \`<reply_to>\` blocks
- Tool outputs

## Napkin Commands

\`\`\`bash
# Search vault
napkin search --vault . "query"

# Read file
napkin read --vault . "path/to/file.md"

# Create new file
napkin create --vault . --path "entities/people/name.md" --content "..."

# Append to existing
napkin append --vault . --path "entities/people/name.md" --content "..."

# Daily note
napkin daily append --vault . --content "..."
\`\`\`

## Conventions

- Files: \`kebab-case.md\`
- Links: \`[[lowercase]]\`
- Paths: \`entities/people/\`, \`entities/resources/\`, \`entities/group-knowledge/\`

## Output

\`\`\`
## Files Created/Updated
- path - description

## Skipped
- reason
\`\`\`
`;

export interface KbDistillOptions {
  dataDir: string;
  backfill?: boolean;
  dryRun?: boolean;
}

interface MessageRow {
  role: string;
  content: string;
  createdAt: number;
}

interface ExportedMessage {
  ts: number;
  role: string;
  content: string;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function todayDate(): string {
  return formatDate(Date.now());
}

function exportMessageToJsonl(msg: MessageRow): ExportedMessage {
  return {
    ts: msg.createdAt,
    role: msg.role,
    content: msg.content,
  };
}

function getMessagesDir(groupWorkspace: string): string {
  return join(groupWorkspace, ".messages");
}

function getDateFile(messagesDir: string, date: string): string {
  return join(messagesDir, `${date}.jsonl`);
}

function md5(content: string): string {
  return new Bun.CryptoHasher("md5").update(content).digest("hex");
}

/**
 * Export messages from DB to daily JSONL files for a group.
 * Returns set of dates that changed (need distillation).
 */
export function exportMessages(
  db: Database,
  groupId: string,
  groupWorkspace: string,
): Set<string> {
  const messagesDir = getMessagesDir(groupWorkspace);
  mkdirSync(messagesDir, { recursive: true });

  const rows = db
    .query(
      `SELECT role, content, created_at as createdAt
       FROM messages
       WHERE group_id = ?
       ORDER BY id ASC`,
    )
    .all(groupId) as MessageRow[];

  // Group by date
  const byDate = new Map<string, ExportedMessage[]>();
  for (const row of rows) {
    const date = formatDate(row.createdAt);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)?.push(exportMessageToJsonl(row));
  }

  // Write files, track which changed
  const changed = new Set<string>();
  for (const [date, messages] of byDate) {
    const filePath = getDateFile(messagesDir, date);
    const newContent = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;

    const oldHash = existsSync(filePath)
      ? md5(readFileSync(filePath, "utf-8"))
      : "";
    writeFileSync(filePath, newContent);
    const newHash = md5(newContent);

    if (oldHash !== newHash) {
      changed.add(date);
    }
  }

  return changed;
}

/**
 * Run kb-distiller on a specific date's messages
 */
async function runDistiller(
  groupWorkspace: string,
  dateFile: string,
): Promise<boolean> {
  const task = `Distill knowledge from: ${dateFile}`;

  // Write prompt to temp file
  const promptFile = join(tmpdir(), `kb-distiller-${process.pid}.md`);
  writeFileSync(promptFile, KB_DISTILLER_PROMPT);

  return new Promise((resolve) => {
    const child = spawn(
      "pi",
      [
        "--print",
        "--no-session",
        "--tools",
        "read,bash,write",
        "--append-system-prompt",
        promptFile,
        task,
      ],
      { cwd: groupWorkspace, env: process.env, stdio: "inherit" },
    );

    child.on("close", (code) => {
      try {
        unlinkSync(promptFile);
      } catch {}
      resolve(code === 0);
    });
    child.on("error", () => {
      try {
        unlinkSync(promptFile);
      } catch {}
      resolve(false);
    });
  });
}

/**
 * Main distillation logic
 */
export async function kbDistill(options: KbDistillOptions): Promise<void> {
  const { dataDir, backfill, dryRun } = options;
  const dbPath = join(dataDir, "state.db");
  const groupsDir = join(dataDir, "groups");

  if (!existsSync(dbPath)) {
    logger.error("Database not found", { dbPath });
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });

  // Get all groups
  const groups = db
    .query("SELECT DISTINCT group_id as groupId FROM messages")
    .all() as { groupId: string }[];

  logger.info("KB distill starting", { groups: groups.length, backfill });

  for (const { groupId } of groups) {
    // Derive workspace path from group ID
    const workspaceName = groupId
      .replace(/:/g, "_")
      .replace(/@/g, "_")
      .replace(/\./g, "_");
    const groupWorkspace = join(groupsDir, workspaceName);

    if (!existsSync(groupWorkspace)) {
      logger.debug("Skipping group - workspace not found", { groupId });
      continue;
    }

    // Export messages to JSONL files, get changed dates
    const changed = exportMessages(db, groupId, groupWorkspace);

    // Determine which dates to distill
    const dates = backfill
      ? [...changed].sort()
      : changed.has(todayDate())
        ? [todayDate()]
        : [];

    if (dates.length === 0) {
      logger.debug("No changes to distill", { groupId });
      continue;
    }

    logger.info("Distilling group", { groupId, dates });

    // Run distiller on changed dates
    for (const date of dates) {
      const dateFile = getDateFile(getMessagesDir(groupWorkspace), date);

      if (dryRun) {
        logger.info("Dry run - would process", { dateFile });
        continue;
      }

      const success = await runDistiller(groupWorkspace, dateFile);
      if (success) {
        logger.info("Distillation complete", { groupId, date });
      } else {
        logger.error("Distillation failed", { groupId, date });
      }
    }
  }

  db.close();
}
