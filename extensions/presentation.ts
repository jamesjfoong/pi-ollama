import { getCacheAgeMs, isCacheFresh, loadCache } from "./cache";
import type { DiscoveryResult } from "./types";
import type { CommandContext, DiscoveredModel, OllamaConfig } from "./types";

export function modelTags(model: { reasoning: boolean; input: readonly string[] }): string {
	const tags: string[] = [];
	if (model.reasoning) tags.push("reasoning");
	if (model.input.includes("image")) tags.push("vision");
	return tags.join(", ") || "text-only";
}

export function modelOption(model: DiscoveredModel, duplicateName = false): string {
	const name = duplicateName ? `${model.name} (${model.id})` : model.name;
	return `${name} · ${modelTags(model)} · context=${model.contextWindow.toLocaleString("en-US")}`;
}

export function formatDuration(ms?: number): string {
	if (!ms || ms < 1000) return "<1s";
	const sec = Math.floor(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	return `${min}m ${sec % 60}s`;
}

export async function selectModel(
	ctx: CommandContext,
	title: string,
	models: DiscoveredModel[],
): Promise<DiscoveredModel | undefined> {
	const query = ((await ctx.ui.input("Filter models (optional)", "")) ?? "").trim().toLowerCase();
	const filtered = query
		? models.filter((model) => modelOption(model, true).toLowerCase().includes(query))
		: models;
	if (filtered.length === 0) {
		ctx.ui.notify(`[pi-ollama] No models match "${query}"`, "warning");
		return undefined;
	}
	const names = new Map<string, number>();
	for (const model of filtered) names.set(model.name, (names.get(model.name) ?? 0) + 1);
	const options = filtered.map((model) => modelOption(model, (names.get(model.name) ?? 0) > 1));
	const choice = await ctx.ui.select(title, options);
	if (!choice) return undefined;
	const index = options.indexOf(choice);
	return index >= 0 ? filtered[index] : undefined;
}

function keyPoolSummary(config: OllamaConfig): string {
	const keys = config.apiKeys ?? [config.apiKey];
	if (keys.length <= 1) return "single";
	return `${keys.length} keys`;
}

export function doctorSummary(
	config: OllamaConfig,
	result: DiscoveryResult | null,
	cache: Awaited<ReturnType<typeof loadCache>>,
): string {
	const lines = [
		"┌─ [pi-ollama] Ollama Doctor",
		"│",
		`│ Endpoint       ${config.baseUrl}`,
		`│ API            ${config.api}`,
		`│ Auth header    ${config.authHeader ? "on" : "off"}`,
		`│ Account        ${config.activeAccount || "default"}`,
		`│ Key pool       ${keyPoolSummary(config)}`,
		`│ Filter         ${config.filter || "none"}`,
		"│",
		"├─ Cache",
	];

	if (cache) {
		lines.push(
			"│  Status        present",
			`│  Age           ${formatDuration(getCacheAgeMs(cache))}`,
			`│  Fresh         ${isCacheFresh(cache) ? "yes" : "no"}`,
			`│  Models        ${cache.models.length}`,
		);
	} else {
		lines.push("│  Status        missing");
	}

	lines.push("│", "├─ Discovery");
	if (result) {
		lines.push(
			`│  Source        ${result.source}`,
			`│  Models        ${result.models.length}`,
			`│  Enrichment    ${result.enrichment.succeeded}/${result.enrichment.attempted} passed`,
			`│  Failed        ${result.enrichment.failed}`,
		);
		if (result.warnings?.length) lines.push(`│  Warning       ${result.warnings[0]}`);
	} else {
		lines.push("│  Source        none");
	}

	lines.push("└─");
	return lines.join("\n");
}
