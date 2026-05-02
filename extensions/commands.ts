import { getCacheAgeMs, getCacheTtlMs, isCacheFresh, loadCache } from "./cache";
import { loadPersistedConfig, resolveConfig, savePersistedConfig } from "./config";
import { discoverModels } from "./discovery";
import { log } from "./logger";
import { getMatchedOverrideLabels } from "./overrides";
import {
	getCurrentConfig,
	getLastDiscovered,
	getLastRefreshAt,
	getLastResult,
	registerProvider,
	setCurrentConfig,
} from "./provider";
import { runSetupWizard } from "./setup-wizard";
import type { CommandContext, ExtensionAPI, OllamaConfig } from "./types";

/** Return cached config or re-resolve from disk/env. */
function getConfig(): Promise<OllamaConfig> {
	const cached = getCurrentConfig();
	return cached ? Promise.resolve(cached) : resolveConfig();
}

function formatDuration(ms?: number): string {
	if (!ms || ms < 1000) return "<1s";
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const rem = sec % 60;
	return `${min}m ${rem}s`;
}

function keyPoolSummary(config: OllamaConfig): string {
	const keys = config.apiKeys ?? [config.apiKey];
	if (keys.length <= 1) return "keyPool=single";
	const masked = keys.map((k) => {
		if (!k) return "(empty)";
		if (k.length <= 8) return "***";
		return `${k.slice(0, 4)}***`;
	});
	return `keyPool=${keys.length}x keys=${masked.join(", ")}`;
}

function modelTags(model: { reasoning: boolean; input: readonly string[] }): string {
	const tags: string[] = [];
	if (model.reasoning) tags.push("reasoning");
	if (model.input.includes("image")) tags.push("vision");
	return tags.join(", ") || "text-only";
}

async function persistExactModelOverride(
	modelId: string,
	override: NonNullable<OllamaConfig["modelOverrides"]>[string],
): Promise<OllamaConfig> {
	const persisted = await loadPersistedConfig();
	const current = persisted.modelOverrides?.[modelId] ?? {};
	await savePersistedConfig({
		...persisted,
		modelOverrides: {
			...(persisted.modelOverrides ?? {}),
			[modelId]: {
				...current,
				...override,
				compat: override.compat
					? { ...(current.compat ?? {}), ...override.compat }
					: current.compat,
				thinkingLevelMap: override.thinkingLevelMap
					? {
							...(current.thinkingLevelMap ?? {}),
							...override.thinkingLevelMap,
						}
					: current.thinkingLevelMap,
			},
		},
	});
	const next = await resolveConfig();
	setCurrentConfig(next);
	return next;
}

export function registerCommands(pi: ExtensionAPI): void {
	// ---------------------------------------------------------------------------
	// /ollama-setup
	// ---------------------------------------------------------------------------
	pi.registerCommand("ollama-setup", {
		description: "Interactive setup for Ollama auto-discovery endpoint",
		handler: async (_args: unknown, ctx: CommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("[pi-ollama] Setup requires interactive mode", "error");
				return;
			}

			const config = await getConfig();
			const result = await runSetupWizard(ctx, config);

			if (!result) {
				ctx.ui.notify("[pi-ollama] Setup cancelled", "info");
				return;
			}

			// Persist
			setCurrentConfig(result);
			await savePersistedConfig({
				baseUrl: result.baseUrl,
				apiKey: result.apiKey,
				apiKeys: result.apiKeys,
				api: result.api,
				compat: result.compat,
				authHeader: result.authHeader,
				filter: result.filter,
				prefix: result.prefix,
				globalModelDefaults: result.globalModelDefaults,
				modelOverridePatterns: result.modelOverridePatterns,
				modelOverrides: result.modelOverrides,
			});

			// Re-discover and register
			try {
				const discovery = await discoverModels(result);
				registerProvider(pi, result, discovery);
				ctx.ui.notify(`[pi-ollama] ${discovery.models.length} models configured`, "success");
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(
					`[pi-ollama] Config saved, but discovery failed: ${msg.slice(0, 120)}`,
					"warning",
				);
			}
		},
	});

	// ---------------------------------------------------------------------------
	// /ollama-refresh
	// ---------------------------------------------------------------------------
	pi.registerCommand("ollama-refresh", {
		description: "Refresh Ollama model list from API",
		handler: async (_args: unknown, ctx: CommandContext) => {
			const config = await getConfig();
			try {
				const discovery = await discoverModels(config);
				registerProvider(pi, config, discovery);
				ctx.ui.notify(
					`[pi-ollama] ${discovery.models.length} models refreshed (${discovery.source})`,
					"success",
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`[pi-ollama] Refresh failed: ${msg.slice(0, 120)}`, "error");
			}
		},
	});

	// ---------------------------------------------------------------------------
	// /ollama-status
	// ---------------------------------------------------------------------------
	pi.registerCommand("ollama-status", {
		description: "Show Ollama auto-discovery status",
		handler: async (_args: unknown, ctx: CommandContext) => {
			const config = await getConfig();
			const discovered = getLastDiscovered();
			const result = getLastResult();
			if (discovered.length === 0) {
				ctx.ui.notify(`[pi-ollama] No models loaded. Endpoint: ${config.baseUrl}`, "warning");
				return;
			}

			const age = result?.cacheAgeMs ? formatDuration(result.cacheAgeMs) : "n/a";
			const source = result?.source || "unknown";
			const filter = config.filter ? ` filter=${config.filter}` : "";
			const refreshed = formatDuration(Date.now() - getLastRefreshAt());
			const keys = keyPoolSummary(config);
			ctx.ui.notify(
				`[pi-ollama] ${discovered.length} @ ${config.baseUrl} source=${source} ${keys} cacheAge=${age} refreshed=${refreshed} ago${filter}`,
				"info",
			);
		},
	});

	// ---------------------------------------------------------------------------
	// /ollama-doctor
	// ---------------------------------------------------------------------------
	pi.registerCommand("ollama-doctor", {
		description: "Diagnose Ollama endpoint, cache, and discovery state",
		handler: async (_args: unknown, ctx: CommandContext) => {
			const config = await getConfig();
			const result = getLastResult();
			const cache = await loadCache();

			const lines: string[] = [];
			lines.push(`endpoint=${config.baseUrl}`);
			lines.push(`api=${config.api}`);
			lines.push(`authHeader=${config.authHeader ? "on" : "off"}`);
			lines.push(keyPoolSummary(config));
			lines.push(`filter=${config.filter || "(none)"}`);
			lines.push(`cacheTtl=${formatDuration(getCacheTtlMs())}`);

			if (cache) {
				const age = getCacheAgeMs(cache);
				lines.push(
					`cache=present age=${formatDuration(age)} fresh=${isCacheFresh(cache) ? "yes" : "no"} models=${cache.models.length}`,
				);
			} else {
				lines.push("cache=missing");
			}

			if (result) {
				lines.push(`lastSource=${result.source}`);
				lines.push(
					`models=${result.models.length} enrichment=${result.enrichment.succeeded}/${result.enrichment.attempted} ok (${result.enrichment.failed} failed)`,
				);
				if (result.warnings?.length) lines.push(`warnings=${result.warnings[0]}`);
			} else {
				lines.push("lastSource=none");
			}

			const summary = `[pi-ollama] doctor: ${lines.join(" | ")}`;
			ctx.ui.notify(summary, "info");
			log("info", summary);
		},
	});

	// ---------------------------------------------------------------------------
	// /ollama-fix
	// ---------------------------------------------------------------------------
	pi.registerCommand("ollama-fix", {
		description: "Guided fixes for Ollama model capabilities",
		handler: async (_args: unknown, ctx: CommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("[pi-ollama] Model fixes require interactive mode", "error");
				return;
			}

			const models = getLastDiscovered();
			if (models.length === 0) {
				ctx.ui.notify("[pi-ollama] No models loaded yet", "warning");
				return;
			}

			const choice = await ctx.ui.select(
				"Pick a model to fix",
				models.map((m) => m.name),
			);
			if (!choice) return;
			const model = models.find((m) => m.name === choice);
			if (!model) return;

			const action = await ctx.ui.select(`Fix ${model.id}`, [
				"Image / vision support",
				"Thinking / reasoning support",
				"Context window",
				"Max output tokens",
				"Display name",
				"Remove all fixes for this model",
				"Cancel",
			]);
			if (!action || action === "Cancel") return;

			let nextConfig: OllamaConfig | null = null;
			if (action === "Image / vision support") {
				const picked = await ctx.ui.select(
					`Image input for ${model.id} (currently: ${model.input.join("+")})`,
					["Text only", "Text + image", "Cancel"],
				);
				if (!picked || picked === "Cancel") return;
				nextConfig = await persistExactModelOverride(model.id, {
					input: picked === "Text + image" ? ["text", "image"] : ["text"],
				});
			} else if (action === "Thinking / reasoning support") {
				const picked = await ctx.ui.select(
					`Thinking for ${model.id} (currently: ${model.reasoning ? "enabled" : "disabled"})`,
					["Enable thinking", "Disable thinking", "Cancel"],
				);
				if (!picked || picked === "Cancel") return;
				if (picked === "Disable thinking") {
					nextConfig = await persistExactModelOverride(model.id, {
						reasoning: false,
					});
				} else {
					const format = await ctx.ui.select("Thinking format", [
						"default / OpenAI reasoning_effort",
						"qwen-chat-template",
						"qwen",
						"deepseek",
						"zai",
						"Cancel",
					]);
					if (!format || format === "Cancel") return;
					nextConfig = await persistExactModelOverride(model.id, {
						reasoning: true,
						compat: {
							thinkingFormat: format === "default / OpenAI reasoning_effort" ? "openai" : format,
						},
					});
				}
			} else if (action === "Context window") {
				const raw = await ctx.ui.input("Context window tokens", String(model.contextWindow));
				if (raw === null) return;
				const contextWindow = Number(raw);
				if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
					ctx.ui.notify("[pi-ollama] Invalid context window", "error");
					return;
				}
				nextConfig = await persistExactModelOverride(model.id, {
					contextWindow,
				});
			} else if (action === "Max output tokens") {
				const raw = await ctx.ui.input("Max output tokens", String(model.maxTokens));
				if (raw === null) return;
				const maxTokens = Number(raw);
				if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
					ctx.ui.notify("[pi-ollama] Invalid max output tokens", "error");
					return;
				}
				nextConfig = await persistExactModelOverride(model.id, { maxTokens });
			} else if (action === "Display name") {
				const name = await ctx.ui.input("Display name", model.name);
				if (name === null) return;
				nextConfig = await persistExactModelOverride(model.id, { name });
			} else if (action === "Remove all fixes for this model") {
				const confirmed = await ctx.ui.confirm(
					"Remove fixes",
					`Remove all saved fixes for ${model.id}?`,
				);
				if (!confirmed) return;
				const persisted = await loadPersistedConfig();
				const { [model.id]: _removed, ...remaining } = persisted.modelOverrides ?? {};
				await savePersistedConfig({ ...persisted, modelOverrides: remaining });
				nextConfig = await resolveConfig();
				setCurrentConfig(nextConfig);
			}

			if (!nextConfig) return;
			ctx.ui.notify(`[pi-ollama] Saved fixes for ${model.id}`, "success");
			const refresh = await ctx.ui.confirm(
				"Refresh now?",
				"Re-discover and re-register models now?",
			);
			if (refresh) {
				try {
					const discovery = await discoverModels(nextConfig);
					registerProvider(pi, nextConfig, discovery);
					ctx.ui.notify(`[pi-ollama] ${discovery.models.length} models refreshed`, "success");
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					ctx.ui.notify(`[pi-ollama] Fix saved, refresh failed: ${msg.slice(0, 120)}`, "warning");
				}
			}
		},
	});

	// ---------------------------------------------------------------------------
	// /ollama-info
	// ---------------------------------------------------------------------------
	pi.registerCommand("ollama-info", {
		description: "Show details for a specific Ollama model",
		handler: async (_args: unknown, ctx: CommandContext) => {
			const config = await getConfig();
			const models = getLastDiscovered();
			if (models.length === 0) {
				ctx.ui.notify("[pi-ollama] No models loaded yet", "warning");
				return;
			}

			const choice = await ctx.ui.select(
				"Pick a model to inspect",
				models.map((m) => m.name),
			);
			if (!choice) return;

			const model = models.find((m) => m.name === choice);
			if (!model) return;

			const fixes = getMatchedOverrideLabels(model.id, config);
			const fixSummary = fixes.length ? ` fixes=${fixes.join("; ")}` : " fixes=none";
			const thinkingFormat = model.compat?.thinkingFormat
				? ` thinkingFormat=${String(model.compat.thinkingFormat)}`
				: "";

			ctx.ui.notify(
				`[pi-ollama] ${model.id} | ${modelTags(model)} | context=${model.contextWindow.toLocaleString()} maxTokens=${model.maxTokens.toLocaleString()}${thinkingFormat}${fixSummary}`,
				"info",
			);
		},
	});
}
