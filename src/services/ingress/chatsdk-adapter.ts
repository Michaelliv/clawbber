import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCallerId, getPlatformFromThreadId } from "../../core/ingress/chatsdk.js";
import type { AppConfig } from "../../core/config.js";
import { resolveProjectPath } from "../../core/config.js";
import type { Logger } from "../../core/logger.js";
import type { OutputFile, MessageAttachment } from "../../core/types.js";
import type { IngressService, MessageChannel } from "./interface.js";
import type { IncomingMessage } from "./models.js";
import { mkdirSync, writeFileSync } from "node:fs";

export function createChatSdkAdapter(opts: {
  ingress: IngressService;
  config: AppConfig;
  log: Logger;
  adapters: Record<string, any>;
}) {
  const { ingress, config, log, adapters } = opts;

  let cachedBotJids: Set<string> | null = null;

  return async (thread: any, message: any, isMention: boolean): Promise<string | null> => {
    try {
      if (message.author.isMe) return null;

      const text = (message.text || "").trim();
      if (!text) return null;

      const threadId = thread.id || "";
      const platform = getPlatformFromThreadId(threadId);
      const externalId = thread.channelId || threadId;
      const isDM = thread.isDM === true;
      const callerId = getCallerId(platform, message.author);
      const authorName = message.author.userName || message.author.fullName;

      // Detect WhatsApp @mentions
      const rawMentions = message.raw?.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
      if (!cachedBotJids) cachedBotJids = getBotJids(adapters);
      const isWhatsAppMention = platform === "whatsapp" && rawMentions.some((jid: string) => cachedBotJids!.has(jid));
      const effectiveMention = isMention || isWhatsAppMention;

      // Strip mention IDs from text
      const cleanText = effectiveMention ? stripMentionIds(text, cachedBotJids) : text;

      // Download attachments
      const attachments = await downloadAttachments(message.attachments, config, log);

      const incoming: IncomingMessage = {
        platform,
        externalId,
        callerId,
        authorName,
        text: cleanText,
        isDM,
        isMention: effectiveMention,
        attachments,
      };

      const channel = createChannel(thread, threadId, platform, adapters, log);

      await ingress.handleMessage(incoming, channel);
      return null;
    } catch (err) {
      log.error("Message handler error", {
        threadId: thread.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
}

function createChannel(
  thread: any,
  threadId: string,
  platform: string,
  adapters: Record<string, any>,
  log: Logger,
): MessageChannel {
  return {
    async send(text: string) {
      await thread.post(text);
    },
    async sendFiles(text: string, files: OutputFile[]) {
      const adapter = adapters[platform === "whatsapp" ? "whatsapp" : platform];
      if (adapter?._requireSocket) {
        await sendWhatsAppFiles(adapter, threadId, text, files, log);
      } else {
        const fileUploads = files.map((f) => ({
          filename: f.filename,
          data: readFileSync(f.path),
          mimeType: f.mimeType,
        }));
        await thread.post({ raw: text || "", files: fileUploads });
      }
    },
    async markRead() {
      const adapter = adapters[platform === "whatsapp" ? "whatsapp" : platform];
      if (adapter?.markRead) {
        const participant = thread.isDM ? undefined : undefined; // handled by caller
        await adapter.markRead(threadId, [], participant);
      }
    },
    async startTyping() {
      await thread.startTyping();
    },
    async subscribe() {
      try { await thread.subscribe(); } catch {}
    },
  };
}

async function downloadAttachments(
  attachments: any[] | undefined,
  config: AppConfig,
  log: Logger,
): Promise<MessageAttachment[]> {
  if (!attachments || attachments.length === 0) return [];

  const workspace = resolveProjectPath(config.workspaceDir);
  const inboxDir = join(workspace, "inbox");
  mkdirSync(inboxDir, { recursive: true });

  const results: MessageAttachment[] = [];

  for (const att of attachments) {
    try {
      let data: Buffer | undefined;
      if (att.data) {
        data = Buffer.isBuffer(att.data) ? att.data : Buffer.from(att.data);
      } else if (att.fetchData) {
        data = await att.fetchData();
      }
      if (!data) continue;

      const filename = att.name || att.filename || `attachment_${Date.now()}.${att.mimeType?.split("/")[1] || "bin"}`;
      const filePath = join(inboxDir, filename);
      writeFileSync(filePath, data);

      results.push({
        path: filePath,
        type: (att.type === "image" ? "image" : att.type === "audio" ? "audio" : att.type === "video" ? "video" : "document") as any,
        mimeType: att.mimeType || "application/octet-stream",
        filename,
        sizeBytes: data.length,
      });
    } catch (err) {
      log.warn("Failed to download attachment", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function sendWhatsAppFiles(
  adapter: any,
  threadId: string,
  text: string,
  files: OutputFile[],
  log: Logger,
): Promise<void> {
  const { jid: chatJid } = adapter.decodeThreadId(threadId);
  let sock: any;
  try {
    sock = adapter._requireSocket();
  } catch {
    log.warn("WhatsApp socket unavailable, falling back to text-only");
    if (text) await adapter.postMessage(threadId, text);
    return;
  }

  let textSent = !text;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isLast = i === files.length - 1;
    const caption = isLast && !textSent ? text : undefined;

    let buffer: Buffer;
    try {
      buffer = readFileSync(file.path);
    } catch (err) {
      log.error("Failed to read output file", {
        path: file.path,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    try {
      const mime = file.mimeType;
      if (mime.startsWith("image/")) {
        await sock.sendMessage(chatJid, { image: buffer, caption, mimetype: mime });
      } else if (mime.startsWith("video/")) {
        await sock.sendMessage(chatJid, { video: buffer, caption, mimetype: mime });
      } else if (mime.startsWith("audio/")) {
        await sock.sendMessage(chatJid, { audio: buffer, mimetype: mime, ptt: false });
        if (caption) await sock.sendMessage(chatJid, { text: caption });
      } else {
        await sock.sendMessage(chatJid, { document: buffer, fileName: file.filename, mimetype: mime, caption });
      }
      if (caption) textSent = true;
    } catch (err) {
      log.error("Failed to send file via WhatsApp", {
        filename: file.filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!textSent) {
    await sock.sendMessage(chatJid, { text });
  }
}

function getBotJids(adapters: Record<string, any>): Set<string> {
  const jids = new Set<string>();
  try {
    const wa = adapters.whatsapp;
    if (wa?._socket?.user?.id) {
      const raw = wa._socket.user.id;
      jids.add(raw);
      jids.add(raw.replace(/:\d+@/, "@"));
    }
    if (wa?._socket?.user?.lid) {
      jids.add(wa._socket.user.lid);
      jids.add(wa._socket.user.lid.replace(/:\d+@/, "@"));
    }
  } catch {}
  return jids;
}

function stripMentionIds(text: string, botJids: Set<string>): string {
  let result = text;
  for (const jid of botJids) {
    const num = jid.split("@")[0].split(":")[0];
    result = result.replace(new RegExp(`@${num}\\b`, "g"), "").trim();
  }
  return result || text;
}
