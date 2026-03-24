import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(__dirname, "../..");
export const CWD = process.cwd();
export const TEMPLATES_DIR = join(PACKAGE_ROOT, "resources/templates");
export const VALID_EXT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"),
    );
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export function loadEnvFile(envPath: string): Record<string, string> {
  const content = readFileSync(envPath, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      vars[match[1]] = match[2];
    }
  }
  return vars;
}

export function getProjectRoot(): string {
  if (process.env.MERCURY_PROJECT_ROOT) return process.env.MERCURY_PROJECT_ROOT;
  const envPath = join(CWD, ".env");
  if (existsSync(envPath)) {
    const envVars = loadEnvFile(envPath);
    if (envVars.MERCURY_PROJECT_ROOT) return envVars.MERCURY_PROJECT_ROOT;
  }
  return ".";
}

export function getUserExtensionsDir(): string {
  return join(CWD, getProjectRoot(), "extensions");
}

export function getWorkspaceDir(): string {
  return join(CWD, getProjectRoot(), "workspace");
}

export function getMercuryUrl(): string {
  const envPath = join(CWD, ".env");
  let port = "3000";
  if (existsSync(envPath)) {
    const vars = loadEnvFile(envPath);
    if (vars.MERCURY_PORT) port = vars.MERCURY_PORT;
  }
  return process.env.MERCURY_URL || `http://localhost:${port}`;
}

export async function apiCall<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${getMercuryUrl()}/api${path}`;
  const hdrs: Record<string, string> = {
    "content-type": "application/json",
    "x-mercury-caller": "system",
  };
  const apiKey = process.env.MERCURY_API_KEY;
  if (apiKey) hdrs.authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, {
    method,
    headers: hdrs,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : JSON.stringify(data);
    throw new Error(`${res.status}: ${msg}`);
  }
  return data as T;
}

export function getImageTag(envPath?: string): string {
  if (envPath && existsSync(envPath)) {
    const vars = loadEnvFile(envPath);
    if (vars.MERCURY_IMAGE) return vars.MERCURY_IMAGE;
  }
  return "mercury:latest";
}
