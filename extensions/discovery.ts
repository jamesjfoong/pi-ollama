import { getCacheAgeMs, isCacheFresh, loadCache, saveCache } from "./cache";
import {
	CONCURRENCY,
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_MAX_TOKENS,
	ENRICH_TIMEOUT_MS,
	LIST_TIMEOUT_MS,
} from "./constants";
import type { DiscoveredModel, DiscoveryResult, EnrichmentStats, OllamaConfig } from "./types";

function openAiUrl(baseUrl: string, prefix: string | undefined, path: string): string {
	const effectivePrefix = prefix || "/v1";
	const hasPrefix = baseUrl.endsWith(effectivePrefix);
	const base = hasPrefix ? baseUrl : `${baseUrl}${effectivePrefix}`;
	return `${base}${path}`;
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit = {},
	timeoutMs = ENRICH_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(id);
	}
}

function buildAuthHeaders(config: OllamaConfig, keyIndex = 0): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (config.authHeader) {
		const keys = config.apiKeys ?? [config.apiKey];
		const key = keys[keyIndex] || keys[0];
		if (key) {
			headers.Authorization = `Bearer ${key}`;
		}
	}
	return headers;
}

async function tryWithKeyRotation<T>(
	config: OllamaConfig,
	operation: (keyIndex: number) => Promise<T>,
	isAuthError: (err: unknown) => boolean,
): Promise<T> {
	const keys = config.apiKeys ?? [config.apiKey];
	let lastErr: unknown;

	for (let i = 0; i < keys.length; i++) {
		try {
			return await operation(i);
		} catch (err) {
			lastErr = err;
			if (!isAuthError(err) || i === keys.length - 1) {
				throw err;
			}
			// Auth failure — try next key
		}
	}

	throw lastErr;
}

function isAuthFailure(err: unknown): boolean {
	if (err instanceof Error) {
		return /401|403|Unauthorized|Forbidden/i.test(err.message);
	}
	return false;
}

async function discoverOpenAiModelIds(config: OllamaConfig): Promise<string[]> {
	const url = openAiUrl(config.baseUrl, config.prefix, "/models");
	const response = await tryWithKeyRotation(
		config,
		async (keyIndex) => {
			const res = await fetchWithTimeout(
				url,
				{ headers: buildAuthHeaders(config, keyIndex) },
				LIST_TIMEOUT_MS,
			);
			if (!res.ok) {
				throw new Error(`OpenAI-compat API returned ${res.status}: ${await res.text()}`);
			}
			return res;
		},
		isAuthFailure,
	);
	const payload = (await response.json()) as {
		data: Array<{ id: string; object?: string }>;
	};
	return (payload.data || [])
		.filter((m) => m.object === "model" || !m.object)
		.map((m) => m.id)
		.filter(Boolean);
}

async function discoverNativeModelIds(config: OllamaConfig): Promise<string[]> {
	const url = `${config.baseUrl}/api/tags`;
	const response = await tryWithKeyRotation(
		config,
		async (keyIndex) => {
			const res = await fetchWithTimeout(
				url,
				{ headers: buildAuthHeaders(config, keyIndex) },
				LIST_TIMEOUT_MS,
			);
			if (!res.ok) {
				throw new Error(`Native API returned ${res.status}: ${await res.text()}`);
			}
			return res;
		},
		isAuthFailure,
	);
	const payload = (await response.json()) as {
		models?: Array<{ name: string }>;
	};
	return (payload.models || []).map((m) => m.name).filter(Boolean);
}

function extractContextLength(modelInfo: Record<string, unknown>): number {
	for (const [key, value] of Object.entries(modelInfo)) {
		if (!key.endsWith(".context_length")) continue;
		const num = Number(value);
		if (Number.isFinite(num) && num > 0) return num;
	}
	return DEFAULT_CONTEXT_WINDOW;
}

async function enrichModel(config: OllamaConfig, modelId: string): Promise<DiscoveredModel> {
	const url = `${config.baseUrl}/api/show`;
	const response = await tryWithKeyRotation(
		config,
		async (keyIndex) => {
			const res = await fetchWithTimeout(
				url,
				{
					method: "POST",
					headers: buildAuthHeaders(config, keyIndex),
					body: JSON.stringify({ model: modelId, verbose: true }),
				},
				ENRICH_TIMEOUT_MS,
			);
			if (!res.ok) {
				throw new Error(`/api/show ${res.status}: ${await res.text()}`);
			}
			return res;
		},
		isAuthFailure,
	);

	const payload = (await response.json()) as {
		capabilities?: string[];
		model_info?: Record<string, unknown>;
	};

	const capabilities = payload.capabilities || [];
	const vision = capabilities.includes("vision");
	const thinking = capabilities.includes("thinking");
	const contextWindow = extractContextLength(payload.model_info || {});

	return {
		id: modelId,
		name: modelId,
		reasoning: thinking,
		input: vision ? ["text", "image"] : ["text"],
		contextWindow,
		maxTokens: Math.min(DEFAULT_MAX_TOKENS, contextWindow),
	};
}

async function normalizeAndEnrich(
	config: OllamaConfig,
	modelIds: string[],
): Promise<{ models: DiscoveredModel[]; enrichment: EnrichmentStats }> {
	const unique = Array.from(new Set(modelIds)).sort();
	const enrichment: EnrichmentStats = {
		attempted: unique.length,
		succeeded: 0,
		failed: 0,
	};

	const models: DiscoveredModel[] = [];

	for (let i = 0; i < unique.length; i += CONCURRENCY) {
		const batch = unique.slice(i, i + CONCURRENCY);
		const results = await Promise.allSettled(batch.map((id) => enrichModel(config, id)));

		for (let j = 0; j < results.length; j++) {
			const result = results[j];
			if (result.status === "fulfilled") {
				models.push(result.value);
				enrichment.succeeded += 1;
			} else {
				models.push({
					id: batch[j],
					name: batch[j],
					reasoning: false,
					input: ["text"],
					contextWindow: DEFAULT_CONTEXT_WINDOW,
					maxTokens: DEFAULT_MAX_TOKENS,
				});
				enrichment.failed += 1;
			}
		}
	}

	return { models, enrichment };
}

async function discoverLive(config: OllamaConfig): Promise<DiscoveryResult> {
	const errors: string[] = [];

	try {
		const ids = await discoverOpenAiModelIds(config);
		if (ids.length > 0) {
			const { models, enrichment } = await normalizeAndEnrich(config, ids);
			return { source: "live-openai", models, enrichment };
		}
		errors.push("OpenAI-compat endpoint returned empty model list");
	} catch (err) {
		errors.push(`OpenAI-compat endpoint: ${err instanceof Error ? err.message : String(err)}`);
	}

	try {
		const ids = await discoverNativeModelIds(config);
		if (ids.length > 0) {
			const { models, enrichment } = await normalizeAndEnrich(config, ids);
			return { source: "live-native", models, enrichment };
		}
		errors.push("Native API returned empty model list");
	} catch (err) {
		errors.push(`Native API: ${err instanceof Error ? err.message : String(err)}`);
	}

	throw new Error(errors.join("; "));
}

/**
 * Discover available models with cache fallback.
 * - successful live discovery updates cache
 * - on failure, fresh/stale cache is used when available
 */
export async function discoverModels(config: OllamaConfig): Promise<DiscoveryResult> {
	try {
		const live = await discoverLive(config);
		await saveCache({
			baseUrl: config.baseUrl,
			timestamp: Date.now(),
			source: "live",
			models: live.models,
			enrichment: live.enrichment,
		});
		return live;
	} catch (liveErr) {
		const cache = await loadCache();
		if (cache && Array.isArray(cache.models) && cache.models.length > 0) {
			const age = getCacheAgeMs(cache);
			const fresh = isCacheFresh(cache);
			return {
				source: fresh ? "cache-fresh" : "cache-stale",
				models: cache.models,
				enrichment: cache.enrichment,
				cacheAgeMs: age,
				warnings: [
					`Live discovery failed: ${liveErr instanceof Error ? liveErr.message : String(liveErr)}`,
				],
			};
		}
		throw liveErr;
	}
}

/**
 * Determine whether a model should be included in the final provider list.
 * - Excludes embedding models by default (`/embed/i`).
 * - If a user filter regex is provided, only includes matching models.
 */
export function shouldInclude(modelId: string, filter?: string): boolean {
	if (/embed/i.test(modelId)) return false;
	if (filter) {
		try {
			const regex = new RegExp(filter, "i");
			return regex.test(modelId);
		} catch {
			// Invalid regex — ignore filter rather than crashing
		}
	}
	return true;
}
