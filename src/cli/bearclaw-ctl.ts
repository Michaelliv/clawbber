#!/usr/bin/env bun

const API_URL = process.env.BEARCLAW_API_URL;
const CALLER_ID = process.env.BEARCLAW_CALLER_ID;
const GROUP_ID = process.env.BEARCLAW_GROUP_ID;

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

if (!API_URL) fatal("BEARCLAW_API_URL not set");
if (!CALLER_ID) fatal("BEARCLAW_CALLER_ID not set");
if (!GROUP_ID) fatal("BEARCLAW_GROUP_ID not set");

const headers: Record<string, string> = {
  "x-bearclaw-caller": CALLER_ID,
  "x-bearclaw-group": GROUP_ID,
  "content-type": "application/json",
};

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const msg =
      typeof data.error === "string" ? data.error : JSON.stringify(data);
    fatal(`${res.status} — ${msg}`);
  }

  return data;
}

function print(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function usage(): never {
  process.stderr.write(`bearclaw-ctl — manage bearclaw from inside the agent container

Usage:
  bearclaw-ctl whoami
  bearclaw-ctl tasks list
  bearclaw-ctl tasks create --cron <expr> --prompt <text>
  bearclaw-ctl tasks pause <id>
  bearclaw-ctl tasks resume <id>
  bearclaw-ctl tasks delete <id>
  bearclaw-ctl config get [key]
  bearclaw-ctl config set <key> <value>
  bearclaw-ctl roles list
  bearclaw-ctl roles grant <platform-user-id> [--role <role>]
  bearclaw-ctl roles revoke <platform-user-id>
  bearclaw-ctl permissions show [--role <role>]
  bearclaw-ctl permissions set <role> <perm1,perm2,...>
  bearclaw-ctl stop
  bearclaw-ctl compact

Environment:
  BEARCLAW_API_URL       Host API base URL
  BEARCLAW_CALLER_ID     Platform user ID of the caller
  BEARCLAW_GROUP_ID      Current group ID
`);
  process.exit(1);
}

function requireArg(args: string[], index: number, name: string): string {
  const val = args[index];
  if (!val) fatal(`Missing required argument: ${name}`);
  return val;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];
  const sub = args[1];

  switch (cmd) {
    case "whoami": {
      print(await api("GET", "/api/whoami"));
      break;
    }

    case "tasks": {
      if (!sub) usage();
      switch (sub) {
        case "list":
          print(await api("GET", "/api/tasks"));
          break;
        case "create": {
          const cron = parseFlag(args, "--cron");
          const prompt = parseFlag(args, "--prompt");
          if (!cron || !prompt)
            fatal("Usage: tasks create --cron <expr> --prompt <text>");
          print(await api("POST", "/api/tasks", { cron, prompt }));
          break;
        }
        case "pause": {
          const id = requireArg(args, 2, "task id");
          print(await api("POST", `/api/tasks/${id}/pause`));
          break;
        }
        case "resume": {
          const id = requireArg(args, 2, "task id");
          print(await api("POST", `/api/tasks/${id}/resume`));
          break;
        }
        case "delete": {
          const id = requireArg(args, 2, "task id");
          print(await api("DELETE", `/api/tasks/${id}`));
          break;
        }
        default:
          fatal(`Unknown tasks subcommand: ${sub}`);
      }
      break;
    }

    case "config": {
      if (!sub) usage();
      switch (sub) {
        case "get": {
          const data = (await api("GET", "/api/config")) as {
            config: Record<string, string>;
          };
          const key = args[2];
          if (key) {
            const value = data.config[key];
            if (value === undefined) fatal(`Config key not set: ${key}`);
            process.stdout.write(`${value}\n`);
          } else {
            print(data);
          }
          break;
        }
        case "set": {
          const key = requireArg(args, 2, "key");
          const value = requireArg(args, 3, "value");
          print(await api("PUT", "/api/config", { key, value }));
          break;
        }
        default:
          fatal(`Unknown config subcommand: ${sub}`);
      }
      break;
    }

    case "roles": {
      if (!sub) usage();
      switch (sub) {
        case "list":
          print(await api("GET", "/api/roles"));
          break;
        case "grant": {
          const userId = requireArg(args, 2, "platform-user-id");
          const role = parseFlag(args, "--role") ?? "admin";
          print(
            await api("POST", "/api/roles", { platformUserId: userId, role }),
          );
          break;
        }
        case "revoke": {
          const userId = requireArg(args, 2, "platform-user-id");
          print(
            await api("DELETE", `/api/roles/${encodeURIComponent(userId)}`),
          );
          break;
        }
        default:
          fatal(`Unknown roles subcommand: ${sub}`);
      }
      break;
    }

    case "permissions": {
      if (!sub) usage();
      switch (sub) {
        case "show": {
          const role = parseFlag(args, "--role");
          const query = role ? `?role=${encodeURIComponent(role)}` : "";
          print(await api("GET", `/api/permissions${query}`));
          break;
        }
        case "set": {
          const targetRole = requireArg(args, 2, "role");
          const permsStr = requireArg(args, 3, "permissions (comma-separated)");
          const permissions = permsStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          print(
            await api("PUT", "/api/permissions", {
              role: targetRole,
              permissions,
            }),
          );
          break;
        }
        default:
          fatal(`Unknown permissions subcommand: ${sub}`);
      }
      break;
    }

    case "stop": {
      print(await api("POST", "/api/stop"));
      break;
    }

    case "compact": {
      print(await api("POST", "/api/compact"));
      break;
    }

    case "help":
    case "--help":
    case "-h":
      usage();
      break;

    default:
      fatal(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  fatal(String(err));
});
