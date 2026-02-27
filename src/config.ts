import path from "node:path";
import { z } from "zod";

const schema = z.object({
  // ─── Logging ────────────────────────────────────────────────────────
  logLevel: z
    .enum(["debug", "info", "warn", "error", "silent"])
    .default("info"),
  logFormat: z.enum(["text", "json"]).default("text"),

  // ─── AI Model ───────────────────────────────────────────────────────
  modelProvider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-20250514"),

  // ─── Trigger Behavior ───────────────────────────────────────────────
  triggerPatterns: z.string().default("@Pi,Pi"),
  triggerMatch: z.string().default("mention"),

  // ─── Storage ────────────────────────────────────────────────────────
  dataDir: z.string().default(".bearclaw"),
  authPath: z.string().optional(),

  // ─── Container / Agent ──────────────────────────────────────────────
  agentContainerImage: z.string().default("oven/bun:1.3"),
  containerTimeoutMs: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(60 * 60 * 1000)
    .default(5 * 60 * 1000), // 5 minutes
  maxConcurrency: z.coerce.number().int().min(1).max(32).default(2),

  // ─── Rate Limiting ──────────────────────────────────────────────────
  rateLimitPerUser: z.coerce.number().int().min(1).max(1000).default(10),
  rateLimitWindowMs: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60 * 60 * 1000)
    .default(60 * 1000), // 1 minute

  // ─── Chat SDK Server ────────────────────────────────────────────────
  chatSdkPort: z.coerce.number().int().min(1).max(65535).default(8787),
  chatSdkUserName: z.string().default("bearclaw"),

  // ─── Discord ────────────────────────────────────────────────────────
  discordGatewayDurationMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(60 * 60 * 1000)
    .default(10 * 60 * 1000),
  discordGatewaySecret: z.string().optional(),

  // ─── WhatsApp ───────────────────────────────────────────────────────
  enableWhatsApp: z.coerce.boolean().default(false),

  // ─── Media Handling ─────────────────────────────────────────────────
  mediaEnabled: z.coerce.boolean().default(true),
  mediaMaxSizeMb: z.coerce.number().min(1).max(100).default(10),

  // ─── Permissions ────────────────────────────────────────────────────
  admins: z.string().default(""),
});

export type AppConfig = z.infer<typeof schema> & {
  /** Derived paths from dataDir */
  dbPath: string;
  globalDir: string;
  groupsDir: string;
  whatsappAuthDir: string;
};

export function loadConfig(): AppConfig {
  const base = schema.parse({
    // Logging
    logLevel: process.env.BEARCLAW_LOG_LEVEL,
    logFormat: process.env.BEARCLAW_LOG_FORMAT,

    // AI Model
    modelProvider: process.env.BEARCLAW_MODEL_PROVIDER,
    model: process.env.BEARCLAW_MODEL,

    // Trigger Behavior
    triggerPatterns: process.env.BEARCLAW_TRIGGER_PATTERNS,
    triggerMatch: process.env.BEARCLAW_TRIGGER_MATCH,

    // Storage
    dataDir: process.env.BEARCLAW_DATA_DIR,
    authPath: process.env.BEARCLAW_AUTH_PATH,

    // Container / Agent
    agentContainerImage: process.env.BEARCLAW_AGENT_CONTAINER_IMAGE,
    containerTimeoutMs: process.env.BEARCLAW_CONTAINER_TIMEOUT_MS,
    maxConcurrency: process.env.BEARCLAW_MAX_CONCURRENCY,

    // Rate Limiting
    rateLimitPerUser: process.env.BEARCLAW_RATE_LIMIT_PER_USER,
    rateLimitWindowMs: process.env.BEARCLAW_RATE_LIMIT_WINDOW_MS,

    // Chat SDK Server
    chatSdkPort: process.env.BEARCLAW_CHATSDK_PORT,
    chatSdkUserName: process.env.BEARCLAW_CHATSDK_USERNAME,

    // Discord
    discordGatewayDurationMs: process.env.BEARCLAW_DISCORD_GATEWAY_DURATION_MS,
    discordGatewaySecret: process.env.BEARCLAW_DISCORD_GATEWAY_SECRET,

    // WhatsApp
    enableWhatsApp: process.env.BEARCLAW_ENABLE_WHATSAPP,

    // Media Handling
    mediaEnabled: process.env.BEARCLAW_MEDIA_ENABLED,
    mediaMaxSizeMb: process.env.BEARCLAW_MEDIA_MAX_SIZE_MB,

    // Permissions
    admins: process.env.BEARCLAW_ADMINS,
  });

  const dataDir = base.dataDir;

  return {
    ...base,
    dbPath: path.join(dataDir, "state.db"),
    globalDir: path.join(dataDir, "global"),
    groupsDir: path.join(dataDir, "groups"),
    whatsappAuthDir:
      process.env.BEARCLAW_WHATSAPP_AUTH_DIR ??
      path.join(dataDir, "whatsapp-auth"),
  };
}

export function resolveProjectPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), p);
}
