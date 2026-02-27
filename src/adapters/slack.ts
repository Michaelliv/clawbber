/**
 * Slack adapter integration layer.
 *
 * The low-level Slack API is handled by @chat-adapter/slack (SlackAdapter).
 * This module provides the clawbber-specific glue:
 *   - Channel → group mapping (groupId = "slack:<channelId>")
 *   - Trigger matching + routing through the core runtime
 *   - Ambient message capture for non-triggered messages
 *   - DM detection via Slack channel type conventions
 */

import type { Message, Thread } from "chat";
import type { ClawbberCoreRuntime } from "../core/runtime.js";
import { logger } from "../logger.js";

/**
 * Derive the clawbber group ID from a Slack thread.
 *
 * Slack thread IDs are encoded as "slack:<channel>:<threadTs>".
 * We group by channel, so the group ID is "slack:<channel>".
 */
export function slackGroupId(threadId: string): string {
  const parts = threadId.split(":");
  if (parts.length >= 2 && parts[0] === "slack") {
    return `slack:${parts[1]}`;
  }
  // Fallback — use the full thread ID
  return threadId;
}

/**
 * Determine if a Slack thread is a DM.
 *
 * Slack DM channel IDs start with "D". The SlackAdapter also exposes isDM(),
 * but we can derive it from the thread ID directly.
 */
export function isSlackDM(threadId: string): boolean {
  const parts = threadId.split(":");
  if (parts.length >= 2 && parts[0] === "slack") {
    return parts[1].startsWith("D");
  }
  return false;
}

/**
 * Build a platform-qualified caller ID from a Slack message.
 */
export function slackCallerId(message: Message): string {
  const userId = message.author.userId || "unknown";
  return `slack:${userId}`;
}

export interface SlackMessageHandlerOptions {
  core: ClawbberCoreRuntime;
}

/**
 * Create the message handler for Slack threads.
 *
 * Returns a function with the same signature as the WhatsApp handler in chat-sdk.ts,
 * but with Slack-specific group mapping and ambient capture logic.
 */
export function createSlackMessageHandler(opts: SlackMessageHandlerOptions) {
  const { core } = opts;

  return async (
    thread: Thread,
    message: Message,
    isNew: boolean,
  ): Promise<void> => {
    if (message.author.isMe) return;

    const text = message.text.trim();
    if (!text) return;

    const groupId = slackGroupId(thread.id);
    const callerId = slackCallerId(message);
    const isDM = isSlackDM(thread.id);

    logger.debug("slack inbound", {
      groupId,
      callerId,
      isDM,
      threadId: thread.id,
      preview: text.slice(0, 120),
    });

    try {
      const result = await core.handleRawInput({
        groupId,
        rawText: message.text,
        callerId,
        authorName: message.author.userName,
        isDM,
        source: "chat-sdk",
      });

      if (result.type === "ignore") return;

      // Only subscribe/type when we'll actually reply.
      // isNew guard: already-subscribed threads don't need re-subscribing;
      // the chat framework tracks subscription state per thread.
      if (result.type === "assistant" || result.type === "command") {
        if (isNew) await thread.subscribe();
        await thread.startTyping();
      }

      const replyText =
        result.type === "denied" ? result.reason : result.reply;
      if (replyText) {
        logger.info("slack reply", { groupId, preview: replyText.slice(0, 120) });
        await thread.post(replyText);
      }
    } catch (err) {
      logger.error("slack handler error", { groupId, error: err });
    }
  };
}
