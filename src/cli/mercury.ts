#!/usr/bin/env bun

import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { buildAction, dockerfileAction } from "./commands/build.js";
import { chatAction } from "./commands/chat.js";
import {
  pairAction,
  registerConversationCommands,
} from "./commands/conversations.js";
import { doctorAction } from "./commands/doctor.js";
import {
  addAction,
  extensionsListAction,
  removeAction,
} from "./commands/extensions.js";
import { initAction } from "./commands/init.js";
import { registerApiKeyCommands } from "./commands/api-keys.js";
import { startAction, stopAction, restartAction, logsAction } from "./commands/service.js";
import { statusAction } from "./commands/status.js";
import { getVersion } from "./helpers.js";

const program = new Command();

program
  .name("mercury")
  .description("Personal AI assistant for chat platforms")
  .version(getVersion());

program.command("init").description("Initialize a new mercury project").action(initAction);
program.command("start").description("Start Mercury container").action(startAction);
program.command("stop").description("Stop Mercury container").action(stopAction);
program.command("restart").description("Rebuild and restart Mercury").action(restartAction);
program.command("logs").description("View container logs").option("-f, --follow", "Follow log output").action(logsAction);
program.command("dockerfile")
  .description("Generate Dockerfile from extensions")
  .option("--mercury-version <version>", "Mercury npm version or tag (default: current version)")
  .action((opts) => dockerfileAction({ version: opts.mercuryVersion }));

program.command("build")
  .description("Generate Dockerfile and build image locally")
  .option("--mercury-version <version>", "Mercury npm version or tag (default: current version)")
  .action((opts) => buildAction({ version: opts.mercuryVersion }));
program.command("status").description("Show current status and configuration").action(statusAction);
program.command("doctor").description("Check environment and configuration").action(doctorAction);

const authCommand = program.command("auth").description("Authenticate with providers and platforms");
registerAuthCommands(authCommand);

program.command("chat [text...]").description("Send a message to Mercury")
  .option("-p, --port <port>", "Mercury server port", "3000")
  .option("-f, --file <path>", "Attach a file (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc; }, [] as string[])
  .option("--caller <callerId>", "Caller ID", "system")
  .option("--json", "Output raw JSON response")
  .action(chatAction);

const convosCommand = program.command("conversations").alias("convos").description("Manage conversations");
registerConversationCommands(convosCommand);
program.command("pair").description("Show the pairing code for this deployment").action(pairAction);

const extCommand = program.command("extensions").alias("ext").description("Manage extensions");
const apiKeysCommand = program.command("api-keys").alias("keys").description("Manage API keys");
registerApiKeyCommands(apiKeysCommand);

extCommand.command("add <source>").description("Install an extension (local path, npm:<pkg>, or git:<url>)").action(addAction);
extCommand.command("remove <name>").description("Remove an installed extension").action(removeAction);
extCommand.command("list").description("List installed extensions").action(extensionsListAction);

program.parse();
