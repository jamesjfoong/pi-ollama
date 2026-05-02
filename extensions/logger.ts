import { PREFIX } from "./constants";

type LogLevel = "debug" | "info" | "warn" | "error";

const DEBUG_ENABLED =
	process.env.PI_OLLAMA_DEBUG === "1" || process.env.PI_OLLAMA_DEBUG?.toLowerCase() === "true";

/**
 * Logging policy:
 * - warn/error: always emitted
 * - info/debug: emitted only when PI_OLLAMA_DEBUG=1 (or true)
 */
export function log(level: LogLevel, message: string): void {
	if ((level === "debug" || level === "info") && !DEBUG_ENABLED) return;

	const full = `${PREFIX} ${message}`;
	if (level === "error") {
		console.error(full);
	} else if (level === "warn") {
		console.warn(full);
	} else {
		console.log(full);
	}
}
