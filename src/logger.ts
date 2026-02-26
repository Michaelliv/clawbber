type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? "info").toLowerCase();
  switch (normalized) {
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "silent":
      return normalized;
    default:
      return "info";
  }
}

const level = parseLevel(process.env.CLAWSOME_LOG_LEVEL);

function enabled(target: Exclude<LogLevel, "silent">): boolean {
  if (level === "silent") return false;
  return ORDER[target] >= ORDER[level];
}

export const logger = {
  level,
  debug: (...args: unknown[]) => {
    if (enabled("debug")) console.debug("[clawsome]", ...args);
  },
  info: (...args: unknown[]) => {
    if (enabled("info")) console.log("[clawsome]", ...args);
  },
  warn: (...args: unknown[]) => {
    if (enabled("warn")) console.warn("[clawsome]", ...args);
  },
  error: (...args: unknown[]) => {
    if (enabled("error")) console.error("[clawsome]", ...args);
  },
};
