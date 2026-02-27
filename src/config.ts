import path from "node:path";
import { z } from "zod";

const schema = z.object({
  // ─── AI Model ───────────────────────────────────────────────────────
  modelProvider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-20250514"),

  // ─── Trigger Behavior ───────────────────────────────────────────────
  triggerPatterns: z.string().default("@Pi,Pi"),
  triggerMatch: z.string().default("mention"),

  // ─── Storage ────────────────────────────────────────────────────────
  dataDir: z.string().default(".clawbber"),
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

  // ─── Chat SDK Server ────────────────────────────────────────────────
  chatSdkPort: z.coerce.number().int().min(1).max(65535).default(8787),
  chatSdkUserName: z.string().default("clawbber"),

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
    // AI Model
    modelProvider: process.env.CLAWBBER_MODEL_PROVIDER,
    model: process.env.CLAWBBER_MODEL,

    // Trigger Behavior
    triggerPatterns: process.env.CLAWBBER_TRIGGER_PATTERNS,
    triggerMatch: process.env.CLAWBBER_TRIGGER_MATCH,

    // Storage
    dataDir: process.env.CLAWBBER_DATA_DIR,
    authPath: process.env.CLAWBBER_AUTH_PATH,

    // Container / Agent
    agentContainerImage: process.env.CLAWBBER_AGENT_CONTAINER_IMAGE,
    containerTimeoutMs: process.env.CLAWBBER_CONTAINER_TIMEOUT_MS,
    maxConcurrency: process.env.CLAWBBER_MAX_CONCURRENCY,

    // Chat SDK Server
    chatSdkPort: process.env.CLAWBBER_CHATSDK_PORT,
    chatSdkUserName: process.env.CLAWBBER_CHATSDK_USERNAME,

    // Discord
    discordGatewayDurationMs: process.env.CLAWBBER_DISCORD_GATEWAY_DURATION_MS,
    discordGatewaySecret: process.env.CLAWBBER_DISCORD_GATEWAY_SECRET,

    // WhatsApp
    enableWhatsApp: process.env.CLAWBBER_ENABLE_WHATSAPP,

    // Permissions
    admins: process.env.CLAWBBER_ADMINS,
  });

  const dataDir = base.dataDir;

  return {
    ...base,
    dbPath: path.join(dataDir, "state.db"),
    globalDir: path.join(dataDir, "global"),
    groupsDir: path.join(dataDir, "groups"),
    whatsappAuthDir:
      process.env.CLAWBBER_WHATSAPP_AUTH_DIR ??
      path.join(dataDir, "whatsapp-auth"),
  };
}

export function resolveProjectPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), p);
}
