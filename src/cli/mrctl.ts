#!/usr/bin/env bun

const API_URL = process.env.API_URL;
const CALLER_ID = process.env.CALLER_ID;
const SPACE_ID = process.env.SPACE_ID;

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

if (!API_URL) fatal("API_URL not set");
if (!CALLER_ID) fatal("CALLER_ID not set");
if (!SPACE_ID) fatal("SPACE_ID not set");

const headers: Record<string, string> = {
  "x-mercury-caller": CALLER_ID,
  "x-mercury-space": SPACE_ID,
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
  process.stderr.write(`mrctl — manage mercury from inside the agent container

Built-in commands:
  mrctl whoami
  mrctl tasks list|create|pause|resume|run|delete
  mrctl config get|set
  mrctl roles list|grant|revoke
  mrctl permissions show|set
  mrctl spaces list|name|delete
  mrctl conversations list
  mrctl mute <platform-user-id> <duration> [--reason <reason>]
  mrctl unmute <platform-user-id>
  mrctl mutes
  mrctl stop
  mrctl compact
Environment:
  API_URL       Host API base URL
  CALLER_ID     Platform user ID of the caller
  SPACE_ID      Current space ID
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
          const at = parseFlag(args, "--at");
          const prompt = parseFlag(args, "--prompt");
          const silent = args.includes("--silent");
          if (!prompt) fatal("Missing --prompt");
          if (!cron && !at) fatal("Must specify --cron or --at");
          if (cron && at) fatal("Cannot specify both --cron and --at");
          print(await api("POST", "/api/tasks", { cron, at, prompt, silent }));
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
        case "run": {
          const id = requireArg(args, 2, "task id");
          print(await api("POST", `/api/tasks/${id}/run`));
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

    case "spaces": {
      if (!sub) usage();
      switch (sub) {
        case "list": {
          const data = (await api("GET", "/api/spaces")) as {
            spaces: Array<{ id: string; name: string; tags: string | null }>;
          };
          for (const s of data.spaces) {
            const tags = s.tags ? ` [${s.tags}]` : "";
            process.stdout.write(`${s.id}\t${s.name}${tags}\n`);
          }
          break;
        }
        case "name": {
          const name = args[2];
          if (name) {
            print(await api("PUT", "/api/spaces/current/name", { name }));
          } else {
            const data = (await api("GET", "/api/spaces/current")) as {
              space: { id: string; name: string };
            };
            process.stdout.write(`${data.space.name}\n`);
          }
          break;
        }
        case "delete":
          print(await api("DELETE", "/api/spaces/current"));
          break;
        default:
          fatal(`Unknown spaces subcommand: ${sub}`);
      }
      break;
    }

    case "conversations": {
      const action = sub ?? "list";
      switch (action) {
        case "list": {
          const data = (await api("GET", "/api/conversations")) as {
            conversations: Array<{
              id: number;
              platform: string;
              externalId: string;
              kind: string;
              observedTitle: string | null;
              spaceId: string | null;
            }>;
          };
          for (const convo of data.conversations) {
            const title = convo.observedTitle || convo.externalId;
            const status = convo.spaceId ? `→ ${convo.spaceId}` : "(unlinked)";
            process.stdout.write(
              `${convo.id}\t${convo.platform}\t${title}\t${status}\n`,
            );
          }
          break;
        }
        default:
          fatal(`Unknown conversations subcommand: ${action}`);
      }
      break;
    }

    case "mute": {
      const userId = requireArg(args, 1, "platform-user-id");
      const duration = requireArg(args, 2, "duration (e.g. 10m, 1h, 24h)");
      const reason = parseFlag(args, "--reason");
      const confirm = args.includes("--confirm");

      const result = (await api("POST", "/api/mutes", {
        platformUserId: userId,
        duration,
        reason,
        confirm,
      })) as { warning?: boolean; message?: string };

      if (result.warning) {
        process.stdout.write(`${result.message}\n`);
        process.stdout.write(
          `\nTo confirm, run: mrctl mute ${userId} ${duration}${reason ? ` --reason "${reason}"` : ""} --confirm\n`,
        );
      } else {
        print(result);
      }
      break;
    }

    case "unmute": {
      const userId = requireArg(args, 1, "platform-user-id");
      print(
        await api("DELETE", `/api/mutes/${encodeURIComponent(userId)}`),
      );
      break;
    }

    case "mutes": {
      print(await api("GET", "/api/mutes"));
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
      // Should not reach here since non-builtins are handled above
      fatal(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  fatal(String(err));
});
