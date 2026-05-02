import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Runtime configuration for Ollama auto-discovery. */
export interface OllamaConfig {
	baseUrl: string;
	apiKey: string;
	api: string;
	compat: Record<string, unknown>;
	authHeader: boolean;
	filter?: string;
}

/** Shape of the JSON file persisted to disk. */
export interface PersistedConfig extends Partial<OllamaConfig> {
	version?: number;
}

export interface EnrichmentStats {
	attempted: number;
	succeeded: number;
	failed: number;
}

/** A discovered model with normalized Pi provider metadata. */
export interface DiscoveredModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: ["text"] | ["text", "image"];
	contextWindow: number;
	maxTokens: number;
}

export interface DiscoveryResult {
	source: "live-openai" | "live-native" | "cache-fresh" | "cache-stale";
	models: DiscoveredModel[];
	enrichment: EnrichmentStats;
	cacheAgeMs?: number;
	warnings?: string[];
}

/** Context passed to command handlers by the pi runtime. */
export interface CommandContext {
	hasUI: boolean;
	ui: {
		input: (title: string, placeholder?: string) => Promise<string | null>;
		confirm: (title: string, message: string) => Promise<boolean>;
		select: (title: string, options: string[]) => Promise<string | null>;
		notify: (message: string, type?: string) => void;
	};
}

/** Session start event context. */
export interface SessionContext {
	ui: {
		notify: (message: string, type?: string) => void;
	};
}

export type { ExtensionAPI };
