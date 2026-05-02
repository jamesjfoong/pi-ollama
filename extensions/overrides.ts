import { THINKING_LEVELS } from "./constants";
import type { DiscoveredModel, ModelOverride, ModelOverridePattern, OllamaConfig } from "./types";

export interface OverrideApplication {
	models: DiscoveredModel[];
	warnings: string[];
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidInput(value: unknown): value is ["text"] | ["text", "image"] {
	return (
		Array.isArray(value) &&
		(value.length === 1 || value.length === 2) &&
		value[0] === "text" &&
		(value.length === 1 || value[1] === "image")
	);
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function filterNumberMap(
	value: unknown,
	keys: string[],
	path: string,
	warnings: string[],
): Record<string, number> | undefined {
	if (!isPlainObject(value)) {
		warnings.push(`Ignoring ${path}: expected object`);
		return undefined;
	}

	const out: Record<string, number> = {};
	for (const key of keys) {
		if (!(key in value)) continue;
		const item = value[key];
		if (typeof item === "number" && Number.isFinite(item) && item >= 0) {
			out[key] = item;
		} else {
			warnings.push(`Ignoring ${path}.${key}: expected non-negative number`);
		}
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeOverride(
	override: ModelOverride | undefined,
	path: string,
	warnings: string[],
): ModelOverride | undefined {
	if (!override) return undefined;
	if (!isPlainObject(override)) {
		warnings.push(`Ignoring ${path}: expected object`);
		return undefined;
	}

	const raw = override as Record<string, unknown>;
	const out: ModelOverride = {};

	if ("id" in raw) warnings.push(`Ignoring ${path}.id: model IDs cannot be overridden`);

	if ("name" in raw) {
		if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name;
		else warnings.push(`Ignoring ${path}.name: expected non-empty string`);
	}
	if ("api" in raw) {
		if (typeof raw.api === "string" && raw.api.trim()) out.api = raw.api;
		else warnings.push(`Ignoring ${path}.api: expected non-empty string`);
	}
	if ("baseUrl" in raw) {
		if (typeof raw.baseUrl === "string" && raw.baseUrl.trim()) out.baseUrl = raw.baseUrl;
		else warnings.push(`Ignoring ${path}.baseUrl: expected non-empty string`);
	}
	if ("reasoning" in raw) {
		if (typeof raw.reasoning === "boolean") out.reasoning = raw.reasoning;
		else warnings.push(`Ignoring ${path}.reasoning: expected boolean`);
	}
	if ("input" in raw) {
		if (isValidInput(raw.input)) out.input = raw.input;
		else warnings.push(`Ignoring ${path}.input: expected ["text"] or ["text", "image"]`);
	}
	if ("contextWindow" in raw) {
		if (isPositiveNumber(raw.contextWindow)) out.contextWindow = raw.contextWindow;
		else warnings.push(`Ignoring ${path}.contextWindow: expected positive number`);
	}
	if ("maxTokens" in raw) {
		if (isPositiveNumber(raw.maxTokens)) out.maxTokens = raw.maxTokens;
		else warnings.push(`Ignoring ${path}.maxTokens: expected positive number`);
	}
	if ("cost" in raw) {
		const cost = filterNumberMap(
			raw.cost,
			["input", "output", "cacheRead", "cacheWrite"],
			`${path}.cost`,
			warnings,
		);
		if (cost) out.cost = cost;
	}
	if ("headers" in raw) {
		if (isPlainObject(raw.headers)) out.headers = raw.headers as Record<string, string>;
		else warnings.push(`Ignoring ${path}.headers: expected object`);
	}
	if ("compat" in raw) {
		if (isPlainObject(raw.compat)) out.compat = raw.compat;
		else warnings.push(`Ignoring ${path}.compat: expected object`);
	}
	if ("thinkingLevelMap" in raw) {
		if (isPlainObject(raw.thinkingLevelMap)) {
			const map: NonNullable<ModelOverride["thinkingLevelMap"]> = {};
			for (const level of THINKING_LEVELS) {
				if (!(level in raw.thinkingLevelMap)) continue;
				const value = raw.thinkingLevelMap[level];
				if (typeof value === "string" || value === null) map[level] = value;
				else warnings.push(`Ignoring ${path}.thinkingLevelMap.${level}: expected string or null`);
			}
			if (Object.keys(map).length > 0) out.thinkingLevelMap = map;
		} else {
			warnings.push(`Ignoring ${path}.thinkingLevelMap: expected object`);
		}
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

export function mergeModelOverride(
	model: DiscoveredModel,
	override: ModelOverride | undefined,
	path = "override",
	warnings: string[] = [],
): DiscoveredModel {
	const clean = sanitizeOverride(override, path, warnings);
	if (!clean) return model;

	return {
		...model,
		...clean,
		id: model.id,
		cost: clean.cost ? { ...(model.cost ?? {}), ...clean.cost } : model.cost,
		headers: clean.headers ? { ...(model.headers ?? {}), ...clean.headers } : model.headers,
		compat: clean.compat ? { ...(model.compat ?? {}), ...clean.compat } : model.compat,
		thinkingLevelMap: clean.thinkingLevelMap
			? { ...(model.thinkingLevelMap ?? {}), ...clean.thinkingLevelMap }
			: model.thinkingLevelMap,
	};
}

function patternMatches(
	pattern: ModelOverridePattern,
	modelId: string,
	index: number,
	warnings: string[],
): boolean {
	if (!pattern || typeof pattern.match !== "string") {
		warnings.push(`Ignoring modelOverridePatterns[${index}]: missing match regex`);
		return false;
	}
	try {
		return new RegExp(pattern.match, "i").test(modelId);
	} catch (err) {
		warnings.push(
			`Ignoring modelOverridePatterns[${index}]: invalid regex ${JSON.stringify(pattern.match)} (${err instanceof Error ? err.message : String(err)})`,
		);
		return false;
	}
}

export function applyModelOverrides(
	models: DiscoveredModel[],
	config: OllamaConfig,
): OverrideApplication {
	const warnings: string[] = [];
	const out = models.map((model) => {
		let merged = mergeModelOverride(
			model,
			config.globalModelDefaults,
			"globalModelDefaults",
			warnings,
		);

		(config.modelOverridePatterns ?? []).forEach((pattern, index) => {
			if (patternMatches(pattern, model.id, index, warnings)) {
				merged = mergeModelOverride(
					merged,
					pattern.override,
					`modelOverridePatterns[${index}].override`,
					warnings,
				);
			}
		});

		merged = mergeModelOverride(
			merged,
			config.modelOverrides?.[model.id],
			`modelOverrides.${JSON.stringify(model.id)}`,
			warnings,
		);
		return merged;
	});

	return { models: out, warnings };
}

export function getMatchedOverrideLabels(modelId: string, config: OllamaConfig): string[] {
	const warnings: string[] = [];
	const labels: string[] = [];
	(config.modelOverridePatterns ?? []).forEach((pattern, index) => {
		if (patternMatches(pattern, modelId, index, warnings))
			labels.push(`pattern[${index}]: ${pattern.match}`);
	});
	if (config.modelOverrides?.[modelId]) labels.push(`exact: ${modelId}`);
	return labels;
}
