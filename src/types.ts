export type MessageRole = "user" | "assistant" | "tool" | "ambient";

export interface StoredMessage {
  id: number;
  groupId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTask {
  id: number;
  groupId: string;
  cron: string;
  prompt: string;
  active: number;
  nextRunAt: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface GroupRole {
  groupId: string;
  platformUserId: string;
  role: string;
  grantedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GroupConfigEntry {
  groupId: string;
  key: string;
  value: string;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TriggerMatch = "prefix" | "mention" | "always";

export interface TriggerConfig {
  match: TriggerMatch;
  patterns: string[]; // e.g. ["@Pi", "Pi", "Nano"]
  caseSensitive: boolean;
}
