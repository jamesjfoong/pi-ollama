import { homedir } from "node:os";
import { resolve } from "node:path";
import type { OllamaConfig } from "./types";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
export const CACHE_VERSION = 1;
export const CACHE_PATH = resolve(homedir(), ".pi/agent/cache/pi-ollama-models.json");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export const CONFIG_VERSION = 1;
export const CONFIG_PATH = resolve(homedir(), ".pi/agent/pi-ollama.json");

export const DEFAULTS: Required<
	Omit<
		OllamaConfig,
		| "filter"
		| "apiKeys"
		| "prefix"
		| "globalModelDefaults"
		| "modelOverridePatterns"
		| "modelOverrides"
	>
> = {
	baseUrl: "http://localhost:11434",
	apiKey: "ollama",
	api: "openai-completions",
	compat: {
		supportsDeveloperRole: false,
		supportsReasoningEffort: false,
	},
	authHeader: true,
};

export const DEFAULT_PREFIX = "/v1";
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_TOKENS = 16_384;

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------
export const LIST_TIMEOUT_MS = 8_000;
export const ENRICH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
export const CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
export const PREFIX = "[pi-ollama]";

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
