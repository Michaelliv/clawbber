import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("ws.WebSocket") && msg.includes("not implemented in bun"))
    return;
  originalWarn(...args);
};

import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import {
  connectAdapters,
  disconnectAdapters,
  setupChatSdkAdapters,
} from "./core/ingress/chatsdk.js";
import { createChatSdkSender } from "./core/ingress/chatsdk-sender.js";
import { loadConfig, resolveProjectPath } from "./core/config.js";
import { createIngressService } from "./services/ingress/service.js";
import { createChatSdkAdapter } from "./services/ingress/chatsdk-adapter.js";
import { MercuryCoreRuntime } from "./core/runtime/runtime.js";
import { SubprocessAgent } from "./core/runtime/subprocess.js";
import { createDatabase } from "./core/db.js";
import { createConfigService } from "./services/config/service.js";
import { createConversationService } from "./services/conversations/service.js";
import { createMessageService } from "./services/messages/service.js";
import { createTaskService } from "./services/tasks/service.js";
import { createRoleService } from "./services/roles/service.js";
import { createMuteService } from "./services/mutes/service.js";
import { createUserService } from "./services/users/service.js";
import { createPolicyService } from "./services/policy/service.js";
import { RateLimiter } from "./core/runtime/rate-limiter.js";
import { ConfigRegistry } from "./services/config/registry.js";
import { JobRunner } from "./extensions/jobs.js";
import { ExtensionRegistry } from "./extensions/loader.js";
import {
  installBuiltinSkills,
  installExtensionSkills,
} from "./extensions/skills.js";
import { configureLogger, logger } from "./core/logger.js";
import { createExtensionStateService } from "./extensions/state-service.js";
import { createApp } from "./server.js";
import { createApiKeyService } from "./services/api-keys/service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const startTime = Date.now();

async function main() {
  const config = loadConfig();

  configureLogger({
    level: config.logLevel,
    format: config.logFormat,
  });

  // ─── Create Database & Services ──────────────────────────────────────────

  const database = createDatabase(resolveProjectPath(config.dbPath));
  const configService = createConfigService(database);
  const muteService = createMuteService(database);
  const rolesService = createRoleService(database, configService);
  const rateLimiter = new RateLimiter(config.rateLimitPerUser, config.rateLimitWindowMs);
  rateLimiter.startCleanup();

  const services = {
    config: configService,
    conversations: createConversationService(database, configService),
    messages: createMessageService(database),
    tasks: createTaskService(database, muteService),
    roles: rolesService,
    mutes: muteService,
    users: createUserService(database),
    policy: createPolicyService(config, rolesService, configService, muteService, rateLimiter),
  };

  const agent = new SubprocessAgent(config);
  const core = new MercuryCoreRuntime({ config, database, services, agent });

  // ─── Load Extensions ────────────────────────────────────────────────────

  const registry = new ExtensionRegistry();
  const configRegistry = new ConfigRegistry();
  const extensionsDir = resolveProjectPath(`${config.projectRoot}/extensions`);
  const builtinExtDir = join(__dirname, "extensions");
  const extState = createExtensionStateService(database);

  await registry.loadAll(
    extensionsDir,
    extState,
    services.roles,
    logger,
    configRegistry,
    builtinExtDir,
  );
  logger.info("Extensions loaded", { count: registry.size });

  core.initExtensions(registry);

  const workspace = resolveProjectPath(config.workspaceDir);
  const builtinSkillsDir = join(PACKAGE_ROOT, "resources/skills");
  const builtinSkillNames = new Set<string>();
  if (fs.existsSync(builtinSkillsDir)) {
    for (const e of fs.readdirSync(builtinSkillsDir, { withFileTypes: true })) {
      if (e.isDirectory()) builtinSkillNames.add(e.name);
    }
  }
  installExtensionSkills(registry.list(), workspace, logger, builtinSkillNames);
  installBuiltinSkills(builtinSkillsDir, workspace, logger);

  // ─── Setup Chat SDK Adapters (optional) ──────────────────────────────────

  let adapters: Record<string, any> = {};
  let bot: Chat | null = null;
  const webhooks: Record<
    string,
    (
      request: Request,
      options?: { waitUntil?: (task: Promise<unknown>) => void },
    ) => Promise<Response>
  > = {};

  const hasAdapters = config.enableWhatsApp || config.enableDiscord || config.enableSlack;

  if (hasAdapters) {
    adapters = await setupChatSdkAdapters(config, logger);

    const ingressService = createIngressService(core, config, logger);
    const handleMessage = createChatSdkAdapter({
      ingress: ingressService,
      config,
      log: logger,
      adapters,
    });

    bot = new Chat({
      userName: config.botUsername,
      adapters,
      state: createMemoryState(),
    });

    bot.onNewMention(async (thread, message) => {
      await handleMessage(thread, message, true);
    });
    bot.onSubscribedMessage(async (thread, message) => {
      await handleMessage(thread, message, false);
    });
    bot.onNewMessage(/.+/, async (thread, message) => {
      await handleMessage(thread, message, false);
    });

    await bot.initialize();
    await connectAdapters(adapters, logger);

    const messageSender = createChatSdkSender(bot, core.services.conversations, logger);
    core.startScheduler(messageSender);

    for (const [name, adapter] of Object.entries(adapters)) {
      if ("handleWebhook" in (adapter as any)) {
        webhooks[name] = (request, options) =>
          (adapter as any).handleWebhook(request, options);
      }
    }
  } else {
    logger.info("No chat adapters enabled — running with CLI/API ingress only");
    core.startScheduler();
  }

  // ─── Background Jobs ───────────────────────────────────────────────────

  const jobRunner = new JobRunner();
  jobRunner.start(registry.list(), {
    db: core.database,
    config,
    log: logger,
  });
  core.onShutdown(() => jobRunner.stop());

  const apiKeys = createApiKeyService(database);

  // Ensure an internal API key exists for agent subprocess → API calls
  const existingKeys = apiKeys.list().filter((k) => !k.revokedAt);
  if (existingKeys.length === 0) {
    const { key } = apiKeys.create("default");
    process.env.MERCURY_API_KEY = key;
    logger.info("Generated default API key");
  } else {
    // If we don't have the key in env, create a new internal one
    if (!process.env.MERCURY_API_KEY) {
      const { key } = apiKeys.create("internal");
      process.env.MERCURY_API_KEY = key;
      logger.info("Generated internal API key for agent subprocess");
    }
  }

  const app = createApp({
    core,
    config,
    adapters,
    webhooks,
    startTime,
    registry,
    configRegistry,
    apiKeys,
  });

  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });

  // ─── Shutdown Hooks ─────────────────────────────────────────────────────

  if (bot) {
    const botRef = bot;
    core.onShutdown(async () => {
      logger.info("Shutdown: closing adapters");
      await disconnectAdapters(adapters, logger);
      await botRef.shutdown();
    });
  }

  core.onShutdown(async () => {
    logger.info("Shutdown: stopping HTTP server");
    server.stop(true);
  });

  core.installSignalHandlers();

  logger.info("Server started", {
    port: server.port,

    adapters: Object.keys(adapters).join(", "),
  });
}

main().catch((error) => {
  logger.error("Startup failed", error instanceof Error ? error : undefined);
  process.exit(1);
});
