import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { CWD, getProjectRoot, loadEnvFile } from "../helpers.js";
import { authenticate } from "../whatsapp-auth.js";

export function registerAuthCommands(authCommand: Command): void {
  authCommand
    .command("login [provider]")
    .description(
      "Login with an OAuth provider (anthropic, github-copilot, google-gemini-cli, antigravity, openai-codex)",
    )
    .action(async (providerArg?: string) => {
      const { getOAuthProviders, getOAuthProvider } = await import(
        "@mariozechner/pi-ai"
      );
      const readline = await import("node:readline");
      const { exec } = await import("node:child_process");

      const providers = getOAuthProviders();
      let providerId: string;

      if (providerArg) {
        providerArg = providerArg.trim();
        const provider = getOAuthProvider(providerArg);
        if (!provider) {
          console.error(
            `Unknown provider: ${providerArg}\nAvailable: ${providers.map((p: { id: string }) => p.id).join(", ")}`,
          );
          process.exit(1);
        }
        providerId = providerArg;
      } else {
        console.log("Available OAuth providers:\n");
        for (let i = 0; i < providers.length; i++) {
          console.log(`  ${i + 1}. ${providers[i].name} (${providers[i].id})`);
        }
        console.log();

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question("Select provider (number or id): ", resolve);
        });
        rl.close();

        const num = Number.parseInt(answer, 10);
        if (num >= 1 && num <= providers.length) {
          providerId = providers[num - 1].id;
        } else {
          const provider = getOAuthProvider(answer.trim());
          if (!provider) {
            console.error("Invalid selection.");
            process.exit(1);
          }
          providerId = answer.trim();
        }
      }

      const provider = getOAuthProvider(providerId)!;
      console.log(`\nLogging in to ${provider.name}...`);

      const root = getProjectRoot();
      const authPath = join(CWD, root, "pi-agent", "auth.json");
      const authDir = dirname(authPath);
      if (!existsSync(authDir)) mkdirSync(authDir, { recursive: true });

      let authData: Record<string, unknown> = {};
      if (existsSync(authPath)) {
        try {
          authData = JSON.parse(readFileSync(authPath, "utf-8"));
        } catch {}
      }

      try {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const credentials = await provider.login({
          onAuth: (info: { url: string; instructions?: string }) => {
            console.log(`\nOpen this URL to authenticate:\n\n  ${info.url}\n`);
            if (info.instructions) console.log(info.instructions);
            const openCmd =
              process.platform === "darwin"
                ? "open"
                : process.platform === "win32"
                  ? "start"
                  : "xdg-open";
            exec(`${openCmd} "${info.url}"`);
          },
          onPrompt: async (prompt: {
            message: string;
            placeholder?: string;
          }) => {
            const answer = await new Promise<string>((resolve) => {
              rl.question(
                `${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ""}: `,
                resolve,
              );
            });
            return answer;
          },
          onProgress: (message: string) => {
            console.log(message);
          },
          onManualCodeInput: async () => {
            const answer = await new Promise<string>((resolve) => {
              rl.question("Paste redirect URL or code: ", resolve);
            });
            return answer;
          },
        });

        rl.close();

        authData[providerId] = { type: "oauth", ...credentials };
        writeFileSync(authPath, JSON.stringify(authData, null, 2), "utf-8");
        chmodSync(authPath, 0o600);

        console.log(`\n✓ Logged in to ${provider.name}`);
        console.log(`  Credentials saved to ${authPath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "Login cancelled") {
          console.log("\nLogin cancelled.");
        } else {
          console.error(`\nLogin failed: ${message}`);
        }
        process.exit(1);
      }
    });

  authCommand
    .command("logout [provider]")
    .description("Remove saved OAuth credentials for a provider")
    .action(async (providerArg?: string) => {
      const root = getProjectRoot();
      const authPath = join(CWD, root, "pi-agent", "auth.json");

      if (!existsSync(authPath)) {
        console.log("No credentials found.");
        return;
      }

      let authData: Record<string, unknown>;
      try {
        authData = JSON.parse(readFileSync(authPath, "utf-8"));
      } catch {
        console.log("No credentials found.");
        return;
      }

      if (providerArg) {
        if (!(providerArg in authData)) {
          console.log(`No credentials for ${providerArg}.`);
          return;
        }
        delete authData[providerArg];
        writeFileSync(authPath, JSON.stringify(authData, null, 2), "utf-8");
        console.log(`✓ Removed credentials for ${providerArg}`);
      } else {
        const keys = Object.keys(authData);
        if (keys.length === 0) {
          console.log("No credentials found.");
          return;
        }
        console.log("Logged in providers:");
        for (const key of keys) console.log(`  - ${key}`);
        console.log('\nRun "mercury auth logout <provider>" to remove.');
      }
    });

  authCommand
    .command("status")
    .description("Show authentication status for all providers")
    .action(async () => {
      const { getOAuthProviders } = await import("@mariozechner/pi-ai");

      const root = getProjectRoot();
      const authPath = join(CWD, root, "pi-agent", "auth.json");

      let authData: Record<string, { type?: string; expires?: number }> = {};
      if (existsSync(authPath)) {
        try {
          authData = JSON.parse(readFileSync(authPath, "utf-8"));
        } catch {}
      }

      const envPath = join(CWD, ".env");
      const envVars = existsSync(envPath) ? loadEnvFile(envPath) : {};

      const providers = getOAuthProviders();
      console.log("Authentication status:\n");

      for (const provider of providers) {
        const cred = authData[provider.id];
        if (cred?.type === "oauth") {
          const expired = cred.expires ? Date.now() >= cred.expires : false;
          const status = expired
            ? "expired (will auto-refresh)"
            : "✓ logged in";
          console.log(`  ${provider.name}: ${status}`);
        } else {
          console.log(`  ${provider.name}: not logged in`);
        }
      }

      console.log();
      const apiKeyVars = [
        "MERCURY_ANTHROPIC_API_KEY",
        "MERCURY_ANTHROPIC_OAUTH_TOKEN",
        "MERCURY_OPENAI_API_KEY",
      ];
      let hasEnvKeys = false;
      for (const key of apiKeyVars) {
        if (envVars[key]) {
          console.log(`  ${key}: ✓ set in .env`);
          hasEnvKeys = true;
        }
      }
      if (!hasEnvKeys) console.log("  No API keys found in .env");
    });

  authCommand
    .command("whatsapp")
    .description("Authenticate with WhatsApp via QR code or pairing code")
    .option("--pairing-code", "Use pairing code instead of QR code")
    .option(
      "--phone <number>",
      "Phone number for pairing code (e.g., 14155551234)",
    )
    .action(async (options: { pairingCode?: boolean; phone?: string }) => {
      const envPath = join(CWD, ".env");
      const root = getProjectRoot();

      const authDir =
        process.env.MERCURY_WHATSAPP_AUTH_DIR ||
        join(CWD, root, "whatsapp-auth");
      const statusDir = join(CWD, root);

      try {
        await authenticate({
          authDir,
          statusDir,
          usePairingCode: options.pairingCode,
          phoneNumber: options.phone,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Authentication failed:", message);
        process.exit(1);
      }
    });
}
