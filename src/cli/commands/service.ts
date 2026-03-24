import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CWD, getImageTag, loadEnvFile } from "../helpers.js";

const CONTAINER_NAME = "mercury";

function getPort(): string {
  const envPath = join(CWD, ".env");
  if (existsSync(envPath)) {
    const vars = loadEnvFile(envPath);
    if (vars.MERCURY_PORT) return vars.MERCURY_PORT;
  }
  return "3000";
}

export function startAction(): void {
  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    console.error("Error: .env file not found.");
    console.error("Run 'mercury init' first.");
    process.exit(1);
  }

  // Stop existing container if running
  spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "pipe" });

  const tag = getImageTag(envPath);
  const port = getPort();
  const args = [
    "run", "-d",
    "--name", CONTAINER_NAME,
    "--restart", "unless-stopped",
    "--cap-add", "SYS_ADMIN",
    "--security-opt", "seccomp=unconfined",
    "-v", `${CWD}:/data`,
    "-p", `${port}:${port}`,
  ];

  if (existsSync(envPath)) args.push("--env-file", envPath);
  args.push(tag);

  console.log(`🪽 Starting ${tag}...`);
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("Failed to start container");
    process.exit(result.status ?? 1);
  }

  console.log(`\n✓ Mercury started`);
  console.log(`  Container: ${CONTAINER_NAME}`);
  console.log(`  Port: ${port}`);
  console.log(`  Logs: mercury logs -f`);
}

export function stopAction(): void {
  const check = spawnSync("docker", ["inspect", CONTAINER_NAME], { stdio: "pipe" });
  if (check.status !== 0) {
    console.log("Mercury is not running.");
    return;
  }

  console.log("Stopping mercury...");
  spawnSync("docker", ["stop", CONTAINER_NAME], { stdio: "pipe" });
  spawnSync("docker", ["rm", CONTAINER_NAME], { stdio: "pipe" });
  console.log("✓ Mercury stopped");
}

export function restartAction(): void {
  stopAction();

  const envPath = join(CWD, ".env");
  if (!existsSync(envPath)) {
    console.error("Error: .env file not found.");
    process.exit(1);
  }

  // Rebuild
  console.log("\nRebuilding image...\n");
  // Dynamic import to avoid circular deps
  import("./build.js").then(async ({ buildAction }) => {
    await buildAction();
    console.log();
    startAction();
  });
}

export function logsAction(options: { follow?: boolean }): void {
  const args = ["logs"];
  if (options.follow) args.push("-f");
  args.push(CONTAINER_NAME);

  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("Mercury is not running. Start with: mercury start");
    process.exit(1);
  }
}
