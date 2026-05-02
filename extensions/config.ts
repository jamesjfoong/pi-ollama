import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { CONFIG_PATH, CONFIG_VERSION, DEFAULT_PREFIX, DEFAULTS } from "./constants";
import type { OllamaConfig, PersistedConfig } from "./types";

export {
	CONFIG_PATH,
	CONFIG_VERSION,
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_MAX_TOKENS,
	DEFAULT_PREFIX,
	DEFAULTS,
	ENRICH_TIMEOUT_MS,
	LIST_TIMEOUT_MS,
} from "./constants";

/** Load the persisted JSON config, returning an empty object on any error. */
export async function loadPersistedConfig(): Promise<PersistedConfig> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf-8");
		return JSON.parse(raw) as PersistedConfig;
	} catch {
		return {};
	}
}

/** Atomically write the persisted config file. */
export async function savePersistedConfig(config: PersistedConfig): Promise<void> {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	const tmpFile = `${CONFIG_PATH}.tmp`;
	await writeFile(tmpFile, JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2));
	await rename(tmpFile, CONFIG_PATH);
}

/**
 * Read legacy `models.json` as a fallback for baseUrl / apiKey / api / compat.
 * Returns a partial config so the normal resolution chain can override it.
 */
export async function loadModelsJsonFallback(): Promise<Partial<OllamaConfig>> {
	try {
		const path = resolve(homedir(), ".pi/agent/models.json");
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw);
		const ollama = parsed.providers?.ollama;
		if (!ollama) return {};
		return {
			baseUrl: ollama.baseUrl,
			apiKey: ollama.apiKey,
			apiKeys: ollama.apiKeys,
			api: ollama.api,
			compat: ollama.compat,
			authHeader: ollama.authHeader,
		};
	} catch {
		return {};
	}
}

export function stripTrailingSlash(s: string): string {
	return s.replace(/\/$/, "");
}

export function resolveBaseUrl(input?: string): string {
	return stripTrailingSlash(input || DEFAULTS.baseUrl);
}

export function resolvePrefix(input?: string): string {
	if (input === "") return "";
	return input || DEFAULT_PREFIX;
}

/**
 * Resolve a single API key value.
 * - If prefixed with `!`, treat the remainder as a literal key.
 * - If the value matches an environment variable name, resolve it.
 * - Otherwise return the value as-is.
 */
export function resolveSingleKey(input?: string): string {
	if (!input) return DEFAULTS.apiKey;
	if (input.startsWith("!")) return input.slice(1);
	if (input in process.env) return process.env[input] || DEFAULTS.apiKey;
	return input;
}

/**
 * Resolve API key(s) into a flat array of literal keys.
 * Supports single key, comma-separated string, or array.
 */
export function resolveApiKeys(input?: string | string[]): string[] {
	if (!input) return [DEFAULTS.apiKey];

	const raw: string[] = Array.isArray(input)
		? input
		: input
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);

	const resolved = raw.map(resolveSingleKey);
	return resolved.length > 0 ? resolved : [DEFAULTS.apiKey];
}

/**
 * Build an effective config using the priority chain:
 *   env vars → persisted file → models.json fallback → defaults
 */
export async function resolveConfig(): Promise<OllamaConfig> {
	const persisted = await loadPersistedConfig();
	const fallback = await loadModelsJsonFallback();

	const baseUrl = resolveBaseUrl(
		process.env.OLLAMA_BASE_URL ?? persisted.baseUrl ?? fallback.baseUrl,
	);

	// Prefer apiKeys array, fall back to legacy apiKey
	const keysInput =
		process.env.OLLAMA_API_KEYS ??
		persisted.apiKeys ??
		fallback.apiKeys ??
		process.env.OLLAMA_API_KEY ??
		persisted.apiKey ??
		fallback.apiKey;

	const allKeys = resolveApiKeys(keysInput);

	return {
		baseUrl,
		apiKey: allKeys[0],
		apiKeys: allKeys.length > 1 ? allKeys : undefined,
		api: process.env.OLLAMA_API ?? persisted.api ?? fallback.api ?? DEFAULTS.api,
		compat: persisted.compat ?? fallback.compat ?? DEFAULTS.compat,
		authHeader: persisted.authHeader ?? fallback.authHeader ?? DEFAULTS.authHeader,
		filter: process.env.OLLAMA_FILTER ?? persisted.filter,
		prefix: resolvePrefix(process.env.OLLAMA_PREFIX ?? persisted.prefix ?? fallback.prefix),
		globalModelDefaults: persisted.globalModelDefaults,
		modelOverridePatterns: persisted.modelOverridePatterns,
		modelOverrides: persisted.modelOverrides,
	};
}
