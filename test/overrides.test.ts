import assert from "node:assert";
import { describe, it } from "node:test";
import {
	applyModelOverrides,
	getMatchedOverrideLabels,
	isPlainObject,
	mergeModelOverride,
} from "../extensions/overrides";
import type { DiscoveredModel, OllamaConfig } from "../extensions/types";

const model = (id = "llama3:8b"): DiscoveredModel => ({
	id,
	name: id,
	reasoning: false,
	input: ["text"],
	contextWindow: 128000,
	maxTokens: 16384,
});

const config = (overrides: Partial<OllamaConfig>): OllamaConfig => ({
	baseUrl: "http://localhost:11434",
	apiKey: "ollama",
	api: "openai-completions",
	compat: { supportsDeveloperRole: false },
	authHeader: true,
	...overrides,
});

describe("overrides", () => {
	it("recognizes plain objects only", () => {
		assert.strictEqual(isPlainObject({}), true);
		assert.strictEqual(isPlainObject(null), false);
		assert.strictEqual(isPlainObject([]), false);
	});
	it("applies exact model overrides", () => {
		const result = applyModelOverrides(
			[model("kimi-k2.6")],
			config({
				modelOverrides: {
					"kimi-k2.6": { reasoning: true, input: ["text", "image"] },
				},
			}),
		);

		assert.strictEqual(result.models[0].reasoning, true);
		assert.deepStrictEqual(result.models[0].input, ["text", "image"]);
	});

	it("applies matching patterns in order", () => {
		const result = applyModelOverrides(
			[model("qwen3:8b")],
			config({
				modelOverridePatterns: [
					{ match: "qwen", override: { reasoning: true, maxTokens: 8192 } },
					{ match: "qwen3", override: { maxTokens: 4096 } },
				],
			}),
		);

		assert.strictEqual(result.models[0].reasoning, true);
		assert.strictEqual(result.models[0].maxTokens, 4096);
	});

	it("exact overrides win over patterns", () => {
		const result = applyModelOverrides(
			[model("qwen3:8b")],
			config({
				modelOverridePatterns: [{ match: "qwen", override: { maxTokens: 8192 } }],
				modelOverrides: {
					"qwen3:8b": { maxTokens: 2048 },
				},
			}),
		);

		assert.strictEqual(result.models[0].maxTokens, 2048);
	});

	it("merges compat, cost, headers, and thinkingLevelMap", () => {
		const base = model();
		base.compat = { supportsDeveloperRole: false };
		base.cost = { input: 1, output: 2 };
		base.headers = { "x-a": "a" };
		base.thinkingLevelMap = { high: "high" };

		const result = mergeModelOverride(base, {
			compat: { thinkingFormat: "qwen-chat-template" },
			cost: { cacheRead: 0.1 },
			headers: { "x-b": "b" },
			thinkingLevelMap: { xhigh: "max" },
		});

		assert.deepStrictEqual(result.compat, {
			supportsDeveloperRole: false,
			thinkingFormat: "qwen-chat-template",
		});
		assert.deepStrictEqual(result.cost, {
			input: 1,
			output: 2,
			cacheRead: 0.1,
		});
		assert.deepStrictEqual(result.headers, { "x-a": "a", "x-b": "b" });
		assert.deepStrictEqual(result.thinkingLevelMap, {
			high: "high",
			xhigh: "max",
		});
	});

	it("ignores invalid values and warns", () => {
		const warnings: string[] = [];
		const result = mergeModelOverride(
			model(),
			{
				input: ["image"] as any,
				contextWindow: -1,
				id: "other" as any,
			},
			"bad",
			warnings,
		);

		assert.deepStrictEqual(result.input, ["text"]);
		assert.strictEqual(result.contextWindow, 128000);
		assert.ok(warnings.length >= 3);
	});

	it("invalid regex warns but does not crash", () => {
		const result = applyModelOverrides(
			[model()],
			config({
				modelOverridePatterns: [{ match: "[", override: { reasoning: true } }],
			}),
		);

		assert.strictEqual(result.models[0].reasoning, false);
		assert.ok(result.warnings[0].includes("invalid regex"));
	});

	it("rejects non-object override values", () => {
		const warnings: string[] = [];
		mergeModelOverride(model(), "bad" as any, "bad", warnings);
		assert.ok(warnings[0].includes("expected object"));
	});

	it("rejects non-object cost and thinking map values", () => {
		const warnings: string[] = [];
		mergeModelOverride(
			model(),
			{ cost: "bad" as any, thinkingLevelMap: "bad" as any },
			"bad",
			warnings,
		);
		assert.ok(warnings.some((warning) => warning.includes("cost: expected object")));
		assert.ok(warnings.some((warning) => warning.includes("thinkingLevelMap: expected object")));
	});

	it("rejects invalid scalar and nested override fields", () => {
		const warnings: string[] = [];
		const result = mergeModelOverride(
			model(),
			{
				name: " ",
				api: 1 as any,
				baseUrl: " ",
				reasoning: "yes" as any,
				contextWindow: 0,
				maxTokens: 0,
				cost: { input: "bad" as any },
				headers: [] as any,
				compat: [] as any,
				thinkingLevelMap: { low: 1 as any },
			},
			"bad",
			warnings,
		);
		assert.strictEqual(result.name, "llama3:8b");
		assert.ok(warnings.length >= 9);
	});

	it("warns on pattern without match regex", () => {
		const result = applyModelOverrides([model()], config({ modelOverridePatterns: [{} as any] }));
		assert.ok(result.warnings[0].includes("missing match regex"));
	});

	it("matches exact and pattern override labels", () => {
		const labels = getMatchedOverrideLabels(
			"qwen3:8b",
			config({
				modelOverridePatterns: [{ match: "qwen", override: { reasoning: true } }],
				modelOverrides: { "qwen3:8b": { reasoning: true } },
			}),
		);
		assert.deepStrictEqual(labels, ["pattern[0]: qwen", "exact: qwen3:8b"]);
	});
});
