/**
 * Built-in mrctl command names.
 *
 * Extensions cannot use these names. Update this list whenever
 * a new built-in command is added to mrctl (mercury-ctl).
 */
export const RESERVED_EXTENSION_NAMES = new Set([
	"tasks",
	"roles",
	"permissions",
	"config",
	"groups",
	"stop",
	"compact",
	"ext",
	"whoami",
	"help",
]);
