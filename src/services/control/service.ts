import path from "node:path";
import type { AppConfig } from "../../core/config.js";
import { resolveProjectPath } from "../../core/config.js";
import { compactSession, newSession } from "../../core/runtime/compact.js";
import type { Agent } from "../../core/runtime/agent-interface.js";
import type { AgentQueue } from "../../core/runtime/queue.js";
import type { RoleService } from "../roles/interface.js";
import type { MessageService } from "../messages/interface.js";
import type { ControlService } from "./interface.js";
import type { WhoamiResponse, StopResponse, CompactResponse, NewSessionResponse } from "./models.js";

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolveSessionFile(config: AppConfig, conversationId: string): string {
  const root = resolveProjectPath(config.projectRoot);
  return path.join(root, "sessions", sanitizeFilename(conversationId), "session.jsonl");
}

export function createControlService(
  config: AppConfig,
  agent: Agent,
  queue: AgentQueue,
  roles: RoleService,
  messages: MessageService,
): ControlService {
  return {
    whoami(callerId, role): WhoamiResponse {
      const permissions = [...roles.getRolePermissions(role)];
      return { callerId, role, permissions };
    },

    stop(): StopResponse {
      const stopped = agent.abort();
      const dropped = queue.cancelPending();
      return { stopped, dropped };
    },

    async compact(conversationId): Promise<CompactResponse> {
      const sessionFile = resolveSessionFile(config, conversationId);
      const result = await compactSession(sessionFile, config);
      const boundary = messages.setSessionBoundary(conversationId);
      return { boundary, compaction: result };
    },

    newSession(conversationId): NewSessionResponse {
      const sessionFile = resolveSessionFile(config, conversationId);
      const reset = newSession(sessionFile);
      const boundary = messages.setSessionBoundary(conversationId);
      return { boundary, reset };
    },
  };
}
