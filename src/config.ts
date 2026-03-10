import path from "node:path";
import { z } from "zod";

/** Parse boolean from env var strings — case-insensitive "true"/"1" → true, everything else → false */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((val) => {
    if (typeof val === "boolean") return val;
    const lower = val.toLowerCase();
    return lower === "true" || lower === "1";
  });

const schema = z.object({
  // ─── Logging ────────────────────────────────────────────────────────
  logLevel: z
    .enum(["debug", "info", "warn", "error", "silent"])
    .default("info"),
  logFormat: z.enum(["text", "json"]).default("text"),

  // ─── AI Model ───────────────────────────────────────────────────────
  modelProvider: z.string().default("anthropic"),
  model: z.string().default("claude-opus-4-6"),

  // ─── Trigger Behavior ───────────────────────────────────────────────
  triggerPatterns: z.string().default("@Pi,Pi"),
  triggerMatch: z.string().default("mention"),

  // ─── Storage ────────────────────────────────────────────────────────
  dataDir: z.string().default(".mercury"),
  authPath: z.string().optional(),

  // ─── Container / Agent ──────────────────────────────────────────────
  agentContainerImage: z
    .string()
    .default("ghcr.io/michaelliv/mercury-agent:latest"),
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

  // ─── Server ─────────────────────────────────────────────────────────
  port: z.coerce.number().int().min(1).max(65535).default(8787),
  botUsername: z.string().default("mercury"),

  // ─── Discord ────────────────────────────────────────────────────────
  enableDiscord: booleanFromEnv.default(false),
  discordGatewayDurationMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(60 * 60 * 1000)
    .default(10 * 60 * 1000),
  discordGatewaySecret: z.string().optional(),

  // ─── Slack ──────────────────────────────────────────────────────────
  enableSlack: booleanFromEnv.default(false),

  // ─── Teams ───────────────────────────────────────────────────────────
  enableTeams: booleanFromEnv.default(false),

  // ─── WhatsApp ───────────────────────────────────────────────────────
  enableWhatsApp: booleanFromEnv.default(false),

  // ─── Media Handling ─────────────────────────────────────────────────
  mediaEnabled: booleanFromEnv.default(true),
  mediaMaxSizeMb: z.coerce.number().min(1).max(100).default(10),

  // ─── Permissions ────────────────────────────────────────────────────
  admins: z.string().default(""),
});

export type AppConfig = z.infer<typeof schema> & {
  /** Derived paths from dataDir */
  dbPath: string;
  globalDir: string;
  spacesDir: string;
  whatsappAuthDir: string;
};

export function loadConfig(): AppConfig {
  const base = schema.parse({
    // Logging
    logLevel: process.env.MERCURY_LOG_LEVEL,
    logFormat: process.env.MERCURY_LOG_FORMAT,

    // AI Model
    modelProvider: process.env.MERCURY_MODEL_PROVIDER,
    model: process.env.MERCURY_MODEL,

    // Trigger Behavior
    triggerPatterns: process.env.MERCURY_TRIGGER_PATTERNS,
    triggerMatch: process.env.MERCURY_TRIGGER_MATCH,

    // Storage
    dataDir: process.env.MERCURY_DATA_DIR,
    authPath: process.env.MERCURY_AUTH_PATH,

    // Container / Agent
    agentContainerImage: process.env.MERCURY_AGENT_IMAGE,
    containerTimeoutMs: process.env.MERCURY_CONTAINER_TIMEOUT_MS,
    maxConcurrency: process.env.MERCURY_MAX_CONCURRENCY,

    // Rate Limiting
    rateLimitPerUser: process.env.MERCURY_RATE_LIMIT_PER_USER,
    rateLimitWindowMs: process.env.MERCURY_RATE_LIMIT_WINDOW_MS,

    // Server
    port: process.env.MERCURY_PORT,
    botUsername: process.env.MERCURY_BOT_USERNAME,

    // Discord
    enableDiscord: process.env.MERCURY_ENABLE_DISCORD,
    discordGatewayDurationMs: process.env.MERCURY_DISCORD_GATEWAY_DURATION_MS,
    discordGatewaySecret: process.env.MERCURY_DISCORD_GATEWAY_SECRET,

    // Slack
    enableSlack: process.env.MERCURY_ENABLE_SLACK,

    // Teams
    enableTeams: process.env.MERCURY_ENABLE_TEAMS,

    // WhatsApp
    enableWhatsApp: process.env.MERCURY_ENABLE_WHATSAPP,

    // Media Handling
    mediaEnabled: process.env.MERCURY_MEDIA_ENABLED,
    mediaMaxSizeMb: process.env.MERCURY_MEDIA_MAX_SIZE_MB,

    // Permissions
    admins: process.env.MERCURY_ADMINS,
  });

  const dataDir = base.dataDir;

  return {
    ...base,
    dbPath: path.join(dataDir, "state.db"),
    globalDir: path.join(dataDir, "global"),
    spacesDir: path.join(dataDir, "spaces"),
    whatsappAuthDir:
      process.env.MERCURY_WHATSAPP_AUTH_DIR ??
      path.join(dataDir, "whatsapp-auth"),
  };
}

export function resolveProjectPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), p);
}
