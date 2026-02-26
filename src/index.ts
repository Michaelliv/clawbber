import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { loadConfig } from "./config.js";
import { ClawsomeCoreRuntime } from "./core/runtime.js";
import { logger } from "./logger.js";

async function main() {
  const config = loadConfig();
  const core = new ClawsomeCoreRuntime(config);

  core.startScheduler();

  const callerId = "cli:local";

  const rl = readline.createInterface({ input, output });
  logger.info("Clawsome ready 🦀");
  logger.info(
    `Trigger patterns: ${config.triggerPatterns} (${config.triggerMatch})`,
  );
  logger.info(`Agent runtime: container (${config.agentContainerImage})`);
  logger.info(`Caller ID: ${callerId} (auto-seeded as admin)`);
  logger.info(
    "Input formats: <prompt> (main group), [group] <prompt> (named group)",
  );

  // Seed CLI user as admin
  const seededAdmins = config.admins
    ? config.admins
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!seededAdmins.includes(callerId)) seededAdmins.push(callerId);

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) continue;
    if (line === "exit" || line === "quit") break;

    const groupMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    const groupId = groupMatch?.[1] ?? "main";
    const rawText = groupMatch?.[2] ?? line;

    try {
      const result = await core.handleRawInput({
        groupId,
        rawText,
        callerId,
        isDM: true, // CLI is always treated as DM (no trigger needed)
        source: "cli",
      });

      if (result.type === "command" && result.reply)
        logger.info(`[${groupId}] ${result.reply}`);
      if (result.type === "denied")
        logger.warn(`[${groupId}] Denied: ${result.reason}`);
    } catch (error) {
      logger.error("request failed", error);
    }
  }

  core.stopScheduler();
  rl.close();
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
