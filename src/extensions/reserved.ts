/**
 * Built-in mrctl command names.
 *
 * Extensions cannot use these names. Update this list whenever
 * a new built-in command is added to mrctl.
 */
export const RESERVED_EXTENSION_NAMES = new Set([
  "tasks",
  "roles",
  "permissions",
  "config",
  "spaces",
  "conversations",
  "mute",
  "unmute",
  "mutes",
  "stop",
  "compact",
  "ext",
  "whoami",
  "help",
]);
