import path from "node:path";
import { z } from "zod";

const schema = z.object({
  modelProvider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-20250514"),
  triggerPatterns: z.string().default("@Pi,Pi"),
  triggerMatch: z.string().default("mention"),
  dataDir: z.string().default(".clawsome"),
  maxConcurrency: z.coerce.number().int().min(1).max(32).default(2),
  chatSdkPort: z.coerce.number().int().min(1).max(65535).default(8787),
  chatSdkUserName: z.string().default("clawsome"),
  discordGatewayDurationMs: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(60 * 60 * 1000)
    .default(10 * 60 * 1000),
  discordGatewaySecret: z.string().optional(),
  enableWhatsApp: z.coerce.boolean().default(false),
  authPath: z.string().optional(),
  agentContainerImage: z.string().default("oven/bun:1.3"),
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
    modelProvider: process.env.CLAWSOME_MODEL_PROVIDER,
    model: process.env.CLAWSOME_MODEL,
    triggerPatterns: process.env.CLAWSOME_TRIGGER_PATTERNS,
    triggerMatch: process.env.CLAWSOME_TRIGGER_MATCH,
    dataDir: process.env.CLAWSOME_DATA_DIR,
    maxConcurrency: process.env.CLAWSOME_MAX_CONCURRENCY,
    chatSdkPort: process.env.CLAWSOME_CHATSDK_PORT,
    chatSdkUserName: process.env.CLAWSOME_CHATSDK_USERNAME,
    discordGatewayDurationMs: process.env.CLAWSOME_DISCORD_GATEWAY_DURATION_MS,
    discordGatewaySecret: process.env.CLAWSOME_DISCORD_GATEWAY_SECRET,
    enableWhatsApp: process.env.CLAWSOME_ENABLE_WHATSAPP,
    authPath: process.env.CLAWSOME_AUTH_PATH,
    agentContainerImage: process.env.CLAWSOME_AGENT_CONTAINER_IMAGE,
    admins: process.env.CLAWSOME_ADMINS,
  });

  const dataDir = base.dataDir;

  return {
    ...base,
    dbPath: path.join(dataDir, "state.db"),
    globalDir: path.join(dataDir, "global"),
    groupsDir: path.join(dataDir, "groups"),
    whatsappAuthDir: path.join(dataDir, "whatsapp-auth"),
  };
}

export function resolveProjectPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.join(process.cwd(), p);
}
