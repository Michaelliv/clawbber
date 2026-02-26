import fs from "node:fs";
import path from "node:path";
import makeWASocket, {
  areJidsSameUser,
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  jidDecode,
  makeCacheableSignalKeyStore,
  type proto,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import {
  type Adapter,
  type AdapterPostableMessage,
  type ChatInstance,
  type EmojiValue,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  Message,
  NotImplementedError,
  parseMarkdown,
  type RawMessage,
  stringifyMarkdown,
  type ThreadInfo,
  type WebhookOptions,
} from "chat";
import { logger } from "../logger.js";

type WhatsAppThreadId = {
  chatJid: string;
  threadJid: string;
};

function extractText(message?: proto.IMessage | null): string {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ""
  );
}

function getContextInfo(
  message?: proto.IMessage | null,
): proto.IContextInfo | undefined {
  if (!message) return undefined;
  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.buttonsResponseMessage?.contextInfo ||
    message.templateButtonReplyMessage?.contextInfo ||
    message.listResponseMessage?.contextInfo;

  return contextInfo ?? undefined;
}

function buildReplyContext(
  message?: proto.IMessage | null,
  pushNames?: Map<string, string>,
): string | undefined {
  const contextInfo = getContextInfo(message);
  if (!contextInfo?.quotedMessage) return undefined;

  const quotedText = extractText(contextInfo.quotedMessage).trim();
  const quotedJid = contextInfo.participant || "unknown";
  const quotedName =
    pushNames?.get(quotedJid) || quotedJid.split("@")[0] || "unknown";
  const quotedMessageId = contextInfo.stanzaId || "unknown";

  const lines = [
    `<reply_to name="${quotedName}" jid="${quotedJid}" message_id="${quotedMessageId}">`,
    quotedText || "",
    "</reply_to>",
  ];

  return lines.join("\n");
}

function postableToText(message: AdapterPostableMessage): string {
  if (typeof message === "string") return message;
  if (typeof message === "object" && message !== null) {
    if ("markdown" in message && typeof message.markdown === "string")
      return message.markdown;
    if ("ast" in message && message.ast) return stringifyMarkdown(message.ast);
    if ("raw" in message && typeof message.raw === "string") return message.raw;
  }
  return "";
}

export class WhatsAppBaileysAdapter
  implements Adapter<WhatsAppThreadId, proto.IWebMessageInfo>
{
  readonly name = "whatsapp";
  readonly userName: string;

  private chat?: ChatInstance;
  private sock?: WASocket;
  private connected = false;
  private readonly authDir: string;
  private readonly outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private connectedAtMs = 0;
  private readonly seenMessageIds = new Set<string>();
  private readonly pushNames = new Map<string, string>();

  constructor(options?: { userName?: string; authDir?: string }) {
    this.userName = options?.userName ?? "clawbber";
    this.authDir =
      options?.authDir ?? path.join(process.cwd(), ".clawbber", "whatsapp-auth");
  }

  get botUserId(): string | undefined {
    const jid = this.sock?.user?.id;
    if (!jid) return undefined;
    return jid.split(":")[0];
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    logger.info("whatsapp adapter initialize", { authDir: this.authDir });
    await this.connect();
  }

  private async connect(): Promise<void> {
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestWaWebVersion({}).catch(() => ({
      version: undefined,
    }));

    const waLogger = {
      level: "silent",
      child: () => waLogger,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
    };

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, waLogger),
      },
      logger: waLogger,
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "open") {
        this.connected = true;
        this.connectedAtMs = Date.now();
        this.seenMessageIds.clear();
        logger.info("whatsapp connection open");
        void this.flushOutgoingQueue();
        return;
      }

      if (connection === "close") {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        logger.warn("whatsapp connection closed", { reason });
        if (reason !== DisconnectReason.loggedOut) {
          setTimeout(() => {
            void this.connect();
          }, 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === "status@broadcast") continue;

        const messageId = msg.key.id;
        if (messageId) {
          if (this.seenMessageIds.has(messageId)) continue;
          this.seenMessageIds.add(messageId);
          if (this.seenMessageIds.size > 5000) this.seenMessageIds.clear();
        }

        const tsMs = Number(msg.messageTimestamp ?? 0) * 1000;
        if (
          this.connectedAtMs &&
          tsMs > 0 &&
          tsMs < this.connectedAtMs - 10_000
        ) {
          logger.debug("whatsapp skipping backlog message", {
            remoteJid,
            messageId,
            tsMs,
          });
          continue;
        }

        const sender = msg.key.participant || remoteJid;
        const senderName = msg.pushName || sender.split("@")[0] || "unknown";

        // Track push names for reply context resolution
        if (msg.pushName && sender) {
          this.pushNames.set(sender, msg.pushName);
        }

        let baseText = extractText(msg.message).trim();
        const replyContext = buildReplyContext(msg.message, this.pushNames);

        // WhatsApp @-mentions embed JIDs in text (e.g. "@52669955764381").
        // Replace the bot's JID mention with the configured userName so trigger matching works.
        const contextInfo = getContextInfo(msg.message);
        const mentionedJids = contextInfo?.mentionedJid ?? [];
        const botJid = this.sock?.user?.id;
        const botLid = this.sock?.user?.lid;
        const isBotJid = (jid: string) =>
          (botJid && areJidsSameUser(jid, botJid)) ||
          (botLid && areJidsSameUser(jid, botLid));

        // Replace bot's JID mention with configured userName so trigger patterns match
        for (const jid of mentionedJids) {
          if (isBotJid(jid)) {
            const user = jidDecode(jid)?.user;
            if (user) {
              baseText = baseText.replace(
                new RegExp(`@${user}\\b`, "g"),
                `@${this.userName}`,
              );
            }
          }
        }

        const text = [baseText, replyContext]
          .filter(Boolean)
          .join("\n\n")
          .trim();
        if (!text) continue;
        const threadId = this.encodeThreadId({
          chatJid: remoteJid,
          threadJid: remoteJid,
        });

        logger.info("whatsapp inbound", {
          remoteJid,
          sender,
          isReply: Boolean(replyContext),
          preview: text.slice(0, 120),
        });

        const isDM = !remoteJid.endsWith("@g.us");

        const incoming = new Message<proto.IWebMessageInfo>({
          id: msg.key.id ?? `${Date.now()}`,
          threadId,
          text,
          formatted: parseMarkdown(text),
          raw: msg,
          isMention: true, // always true — router handles trigger matching
          author: {
            userId: sender,
            userName: senderName,
            fullName: senderName,
            isBot: "unknown",
            isMe: false,
          },
          metadata: {
            dateSent: new Date(
              Number(msg.messageTimestamp ?? Date.now() / 1000) * 1000,
            ),
            edited: false,
          },
          attachments: [],
        });

        this.chat?.processMessage(this, threadId, incoming);
      }
    });

    this.sock = sock;
  }

  async handleWebhook(
    _request: Request,
    _options?: WebhookOptions,
  ): Promise<Response> {
    return new Response(
      "WhatsApp adapter uses Baileys socket, no webhook required.",
      { status: 202 },
    );
  }

  encodeThreadId(platformData: WhatsAppThreadId): string {
    return `whatsapp:${platformData.chatJid}:${platformData.threadJid}`;
  }

  decodeThreadId(threadId: string): WhatsAppThreadId {
    const parts = threadId.split(":");
    if (parts.length < 3 || parts[0] !== "whatsapp") {
      throw new Error(`Invalid WhatsApp thread ID: ${threadId}`);
    }
    return {
      chatJid: parts[1],
      threadJid: parts.slice(2).join(":"),
    };
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<proto.IWebMessageInfo>> {
    const { chatJid } = this.decodeThreadId(threadId);
    const text = postableToText(message).trim();
    if (!text) {
      throw new Error("Cannot send empty WhatsApp message");
    }

    if (!this.connected || !this.sock) {
      this.outgoingQueue.push({ jid: chatJid, text });
      logger.warn("whatsapp queued outbound", {
        chatJid,
        queueSize: this.outgoingQueue.length,
      });
      return { id: `queued-${Date.now()}`, threadId, raw: {} };
    }

    logger.info("whatsapp outbound", { chatJid, preview: text.slice(0, 120) });
    const sent = await this.sock.sendMessage(chatJid, { text });
    if (!sent) {
      throw new Error("WhatsApp sendMessage returned no message");
    }
    return {
      id: sent.key?.id ?? `${Date.now()}`,
      threadId,
      raw: sent,
    };
  }

  async editMessage(
    _threadId: string,
    _messageId: string,
    _message: AdapterPostableMessage,
  ): Promise<RawMessage<proto.IWebMessageInfo>> {
    throw new NotImplementedError(
      "WhatsApp does not support generic message edit in this adapter",
    );
  }

  async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new NotImplementedError(
      "WhatsApp delete is not implemented in this adapter",
    );
  }

  async addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "WhatsApp reactions are not implemented in this adapter",
    );
  }

  async removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string,
  ): Promise<void> {
    throw new NotImplementedError(
      "WhatsApp reactions are not implemented in this adapter",
    );
  }

  async fetchMessages(
    _threadId: string,
    _options?: FetchOptions,
  ): Promise<FetchResult<proto.IWebMessageInfo>> {
    return { messages: [] };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { chatJid } = this.decodeThreadId(threadId);
    return {
      id: threadId,
      channelId: `whatsapp:${chatJid}`,
      isDM: !chatJid.endsWith("@g.us"),
      metadata: { chatJid },
    };
  }

  parseMessage(raw: proto.IWebMessageInfo): Message<proto.IWebMessageInfo> {
    const key = raw.key;
    const remoteJid = key?.remoteJid ?? "unknown@s.whatsapp.net";
    const sender = key?.participant || remoteJid;
    const senderName = raw.pushName || sender.split("@")[0] || "unknown";
    const baseText = extractText(raw.message).trim();
    const replyContext = buildReplyContext(raw.message, this.pushNames);
    const text = [baseText, replyContext].filter(Boolean).join("\n\n").trim();
    const threadId = this.encodeThreadId({
      chatJid: remoteJid,
      threadJid: remoteJid,
    });

    return new Message({
      id: key?.id ?? `${Date.now()}`,
      threadId,
      text,
      formatted: parseMarkdown(text),
      raw,
      author: {
        userId: sender,
        userName: senderName,
        fullName: senderName,
        isBot: "unknown",
        isMe: Boolean(key?.fromMe),
      },
      metadata: {
        dateSent: new Date(
          Number(raw.messageTimestamp ?? Date.now() / 1000) * 1000,
        ),
        edited: false,
      },
      attachments: [],
    });
  }

  renderFormatted(content: FormattedContent): string {
    return stringifyMarkdown(content);
  }

  async startTyping(threadId: string): Promise<void> {
    const { chatJid } = this.decodeThreadId(threadId);
    if (!this.sock || !this.connected) return;
    await this.sock.presenceSubscribe(chatJid);
    await this.sock.sendPresenceUpdate("composing", chatJid);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
    this.sock?.end(undefined);
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (!this.sock || !this.connected || this.flushing) return;
    this.flushing = true;
    try {
      if (this.outgoingQueue.length > 0) {
        logger.info("whatsapp flushing outbound queue", {
          count: this.outgoingQueue.length,
        });
      }
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift();
        if (!item) continue;
        await this.sock.sendMessage(item.jid, { text: item.text });
      }
    } finally {
      this.flushing = false;
    }
  }
}

export function createWhatsAppBaileysAdapter(options?: {
  userName?: string;
  authDir?: string;
}): WhatsAppBaileysAdapter {
  return new WhatsAppBaileysAdapter(options);
}
