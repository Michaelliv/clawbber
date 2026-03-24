import type { AppConfig } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";
import type { IngressMessage } from "../../core/types.js";
import type { MercuryCoreRuntime } from "../../core/runtime/runtime.js";
import { handleCommand } from "../../core/ingress/commands.js";
import { loadTriggerConfig, matchTrigger } from "../../core/ingress/trigger.js";
import type { IncomingMessage } from "./models.js";
import type { IngressService, MessageChannel } from "./interface.js";

export function createIngressService(
  core: MercuryCoreRuntime,
  config: AppConfig,
  log: Logger,
): IngressService {
  return {
    async handleMessage(input: IncomingMessage, channel: MessageChannel): Promise<void> {
      const { platform, externalId, callerId, authorName, text, isDM, isMention, attachments } = input;

      if (!text) return;

      const paired = isDM || core.services.conversations.isPaired(platform, externalId);

      // ─── Unpaired: only /pair allowed ─────────────────────────────────
      if (!paired) {
        if (!text.startsWith("/pair ")) return;

        core.services.conversations.create(platform, externalId, "group");
        const code = text.slice(6).trim().toUpperCase();
        const expected = core.services.conversations.getPairingCode();
        if (code === expected) {
          core.services.conversations.regeneratePairingCode();
          core.services.conversations.pair(platform, externalId);
          await channel.send("✅ Paired. This conversation is now active.");
          log.info("Conversation paired", { platform, externalId });
        } else {
          await channel.send("❌ Invalid pairing code.");
        }
        return;
      }

      // ─── Paired from here ─────────────────────────────────────────────

      try { await channel.markRead(); } catch {}
      core.services.conversations.create(platform, externalId, isDM ? "dm" : "group");

      // ─── Check if addressed to bot via mention or trigger pattern ─────
      let addressedToBot = isMention || isDM;
      let strippedText = text;

      if (!addressedToBot && !isDM) {
        const triggerConfig = loadTriggerConfig(core.services.config, {
          patterns: config.triggerPatterns.split(","),
          match: config.triggerMatch,
        });
        const result = matchTrigger(text, triggerConfig, false);
        if (result.matched) {
          addressedToBot = true;
          strippedText = result.prompt;
        }
      }

      // ─── Slash commands (only when addressed to bot) ────────────────────
      if (strippedText.startsWith("/") && addressedToBot) {
        // DM pairing
        if (strippedText.startsWith("/pair ") && isDM) {
          const code = strippedText.slice(6).trim().toUpperCase();
          const expected = core.services.conversations.getPairingCode();
          if (code === expected) {
            core.services.conversations.regeneratePairingCode();
            core.services.roles.set(callerId, "admin", "pair");
            await channel.send("✅ Paired. You are now an admin.");
            log.info("Admin paired via DM", { callerId });
          } else {
            await channel.send("❌ Invalid pairing code.");
          }
          return;
        }

        const isAdmin = core.services.roles.get(callerId) === "admin";
        if (!isAdmin) {
          await channel.send("⛔ Admin only.");
          return;
        }

        if (strippedText === "/unpair") {
          if (core.services.conversations.isPaired(platform, externalId)) {
            core.services.conversations.unpair(platform, externalId);
            await channel.send("✅ Unpaired. I will no longer respond here.");
            log.info("Conversation unpaired", { platform, externalId });
          } else {
            await channel.send("This conversation is not paired.");
          }
          return;
        }

        const cmd = await handleCommand(core, strippedText, isDM, callerId, externalId);
        if (cmd.handled) {
          if (cmd.reply) await channel.send(cmd.reply);
          return;
        }
      }

      if (!addressedToBot) {
        const ambientText = authorName
          ? `${authorName}: ${text.trim()}`
          : text.trim();
        if (ambientText) {
          core.services.messages.create("ambient", ambientText, externalId);
        }
        return;
      }

      // ─── Addressed to bot: run through policy → agent ─────────────────
      try { await channel.subscribe(); } catch {}
      try { await channel.startTyping(); } catch {}

      const ingress: IngressMessage = {
        platform,
        conversationExternalId: externalId,
        callerId,
        authorName,
        text: strippedText,
        isDM,
        isReplyToBot: isMention,
        attachments,
      };

      void (async () => {
        try {
          const result = await core.handleMessage(ingress, "chat-sdk");

          if (result.action === "ignore" || !result.result) return;
          if (result.action === "deny") {
            await channel.send(result.reason);
            return;
          }

          const { text: replyText, files } = result.result;
          if (!replyText && files.length === 0) return;

          if (files.length > 0) {
            await channel.sendFiles(replyText, files);
          } else if (replyText) {
            await channel.send(replyText);
          }
        } catch (err) {
          log.error("Agent processing error", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
  };
}
