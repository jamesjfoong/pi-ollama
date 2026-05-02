import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from "./constants";
import { shouldInclude } from "./discovery";
import { applyModelOverrides } from "./overrides";
import type { DiscoveredModel, DiscoveryResult, ExtensionAPI, OllamaConfig } from "./types";

/** Mutable runtime state — kept in this module to avoid global pollution. */
const state = {
	config: null as OllamaConfig | null,
	models: [] as DiscoveredModel[],
	lastResult: null as DiscoveryResult | null,
	lastRefreshAt: 0,
};

export function setCurrentConfig(config: OllamaConfig): void {
	state.config = config;
}

export function getCurrentConfig(): OllamaConfig | null {
	return state.config;
}

export function getLastDiscovered(): DiscoveredModel[] {
	return state.models;
}

export function getLastResult(): DiscoveryResult | null {
	return state.lastResult;
}

export function getLastRefreshAt(): number {
	return state.lastRefreshAt;
}

/**
 * Register the `ollama` provider with pi using the discovered (and filtered) models.
 */
export function registerProvider(
	pi: ExtensionAPI,
	config: OllamaConfig,
	result: DiscoveryResult,
): void {
	const overrideResult = applyModelOverrides(result.models, config);
	const filtered = overrideResult.models.filter((m) => shouldInclude(m.id, config.filter));
	state.models = filtered;
	state.lastResult = {
		...result,
		models: filtered,
		warnings: [...(result.warnings ?? []), ...overrideResult.warnings],
	};
	state.lastRefreshAt = Date.now();

	const effectiveBaseUrl = config.prefix ? `${config.baseUrl}${config.prefix}` : config.baseUrl;
	pi.registerProvider("ollama", {
		baseUrl: effectiveBaseUrl,
		api: config.api,
		apiKey: config.apiKey,
		compat: config.compat,
		authHeader: config.authHeader,
		models: filtered.map((m) => ({
			id: m.id,
			name: m.name,
			api: m.api,
			baseUrl: m.baseUrl,
			reasoning: m.reasoning,
			thinkingLevelMap: m.thinkingLevelMap,
			input: m.input,
			contextWindow: m.contextWindow || DEFAULT_CONTEXT_WINDOW,
			maxTokens: m.maxTokens || DEFAULT_MAX_TOKENS,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				...(m.cost ?? {}),
			},
			headers: m.headers,
			compat: m.compat,
		})),
	});
}
