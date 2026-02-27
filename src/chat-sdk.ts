import { createDiscordAdapter } from "@chat-adapter/discord";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";
import { type Adapter, Chat, type Message, type Thread } from "chat";
import { createSlackMessageHandler } from "./adapters/slack.js";
import { createWhatsAppBaileysAdapter } from "./adapters/whatsapp.js";
import { loadConfig, resolveProjectPath } from "./config.js";
import { handleApiRequest } from "./core/api.js";
import { ClawbberCoreRuntime } from "./core/runtime.js";
import { loadTriggerConfig, matchTrigger } from "./core/trigger.js";
import { logger } from "./logger.js";

type WaitUntil = (task: Promise<unknown>) => void;

type WebhookHandler = (
  request: Request,
  options?: { waitUntil?: WaitUntil },
) => Promise<Response>;

type DiscordGatewayAdapter = {
  startGatewayListener: (
    options: { waitUntil?: WaitUntil },
    durationMs?: number,
    abortSignal?: AbortSignal,
    webhookUrl?: string,
  ) => Promise<Response>;
};

function resolveCallerId(message: Message, thread: Thread): string {
  const userId = message.author.userId || "unknown";
  const platform = thread.adapter.name;
  return `${platform}:${userId}`;
}

async function main() {
  const config = loadConfig();
  const core = new ClawbberCoreRuntime(config);

  const adapters: Record<string, Adapter> = {};

  if (process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter();
  }

  if (
    process.env.DISCORD_BOT_TOKEN &&
    process.env.DISCORD_PUBLIC_KEY &&
    process.env.DISCORD_APPLICATION_ID
  ) {
    adapters.discord = createDiscordAdapter();
  }

  if (config.enableWhatsApp) {
    adapters.whatsapp = createWhatsAppBaileysAdapter({
      userName: config.chatSdkUserName,
      authDir: resolveProjectPath(config.whatsappAuthDir),
    });
  }

  if (Object.keys(adapters).length === 0) {
    throw new Error(
      "No adapters enabled. Configure Slack/Discord env or set CLAWBBER_ENABLE_WHATSAPP=true",
    );
  }

  const bot = new Chat({
    userName: config.chatSdkUserName,
    adapters,
    state: createMemoryState(),
  });

  // Slack-specific handler: channel→group mapping, pre-route typing, ambient capture
  const handleSlackMessage = createSlackMessageHandler({
    core,
    db: core.db,
    config,
  });

  // Default handler for WhatsApp/Discord/other adapters
  const handleMessage = async (
    thread: Thread,
    message: Message,
    isNew: boolean,
  ) => {
    if (message.author.isMe) return;

    // Delegate to platform-specific handlers early — before any
    // WhatsApp-specific logic (resolveCallerId, @g.us DM check).
    if (thread.adapter.name === "slack") {
      return handleSlackMessage(thread, message, isNew);
    }

    const callerId = resolveCallerId(message, thread);

    // thread.isDM is unreliable for WhatsApp LID JIDs — derive from thread ID
    const isDM = thread.isDM || !thread.id.includes("@g.us");

    // Quick trigger check before starting typing indicator
    const text = message.text.trim();
    if (!text) return;

    const defaultPatterns = config.triggerPatterns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const triggerConfig = loadTriggerConfig(
      core.db,
      thread.id,
      { patterns: defaultPatterns, match: config.triggerMatch },
    );
    const triggerResult = matchTrigger(text, triggerConfig, isDM);

    // Only start typing if trigger matched (or DM)
    if (triggerResult.matched) {
      if (isNew) await thread.subscribe();
      await thread.startTyping();
    }

    const result = await core.handleRawInput({
      groupId: thread.id,
      rawText: message.text,
      callerId,
      authorName: message.author.userName,
      isDM,
      source: "chat-sdk",
    });

    if (result.type === "ignore") return;

    if (result.type === "assistant" && result.reply) {
      await thread.post(result.reply);
    } else if (result.type === "command" && result.reply) {
      await thread.post(result.reply);
    } else if (result.type === "denied") {
      await thread.post(result.reason);
    }
  };

  bot.onNewMention((thread, message) => {
    void handleMessage(thread, message, true).catch((error) =>
      logger.error("chat-sdk message handler failed", error),
    );
  });

  bot.onSubscribedMessage((thread, message) => {
    void handleMessage(thread, message, false).catch((error) =>
      logger.error("chat-sdk message handler failed", error),
    );
  });

  core.startScheduler();
  await bot.initialize();

  const webhooks = bot.webhooks as Record<string, WebhookHandler>;

  const waitUntil: WaitUntil = (task) => {
    void task.catch((error) => {
      logger.error("background task failed", error);
    });
  };

  const apiCtx = {
    db: core.db,
    config,
    containerRunner: core.containerRunner,
    queue: core.queue,
  };

  const server = Bun.serve({
    port: config.chatSdkPort,
    fetch: async (request) => {
      const url = new URL(request.url);

      // Internal API — used by clawbber-ctl from inside containers
      if (url.pathname.startsWith("/api/")) {
        return handleApiRequest(request, url, apiCtx);
      }

      logger.info("chat-sdk incoming request", {
        method: request.method,
        path: url.pathname,
      });

      if (url.pathname === "/discord/gateway" && request.method === "GET") {
        if (!adapters.discord) {
          return new Response("Discord adapter not configured", {
            status: 400,
          });
        }

        if (config.discordGatewaySecret) {
          const authHeader = request.headers.get("authorization");
          if (authHeader !== `Bearer ${config.discordGatewaySecret}`) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const discord = bot.getAdapter(
          "discord",
        ) as unknown as DiscordGatewayAdapter;
        return discord.startGatewayListener(
          { waitUntil },
          config.discordGatewayDurationMs,
        );
      }

      const match = url.pathname.match(/^\/webhooks\/([a-z0-9_-]+)$/i);
      if (!match) {
        return new Response("Not found", { status: 404 });
      }

      const platform = match[1];
      logger.info("chat-sdk webhook dispatch", { platform });
      const handler = webhooks[platform];
      if (!handler) {
        return new Response(`Unknown platform: ${platform}`, { status: 404 });
      }

      return handler(request, { waitUntil });
    },
  });

  logger.info(`Chat SDK server listening on http://localhost:${server.port}`);
  logger.info(`Agent runtime: container (${config.agentContainerImage})`);
  logger.info(`Enabled adapters: ${Object.keys(adapters).join(", ")}`);
  logger.info("Webhook path pattern: POST /webhooks/:platform");
  logger.info("Internal API: /api/*");
  if (adapters.discord)
    logger.info("Discord gateway trigger: GET /discord/gateway");
  if (adapters.whatsapp)
    logger.info(
      `WhatsApp auth dir: ${resolveProjectPath(config.whatsappAuthDir)}`,
    );
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
