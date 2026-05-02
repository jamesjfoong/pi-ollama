import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { unlink } from "node:fs/promises";
import { CACHE_PATH } from "../extensions/constants";
import { saveCache } from "../extensions/cache";
import { discoverModels } from "../extensions/discovery";
import type { OllamaConfig } from "../extensions/types";

const BASE = "http://localhost:19999";

const makeConfig = (overrides: Partial<OllamaConfig> = {}): OllamaConfig => ({
	baseUrl: BASE,
	apiKey: "test",
	api: "openai-completions",
	compat: {},
	authHeader: true,
	prefix: "/v1",
	...overrides,
});

const originalFetch = globalThis.fetch;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function mockFetchWith(routes: Record<string, (url: string, init?: RequestInit) => Response>) {
	globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		for (const [pattern, handler] of Object.entries(routes)) {
			if (url.includes(pattern)) return Promise.resolve(handler(url, init));
		}
		return Promise.resolve(new Response("not found", { status: 404 }));
	};
}

describe("discovery (HTTP)", () => {
	beforeEach(async () => {
		try {
			await unlink(CACHE_PATH);
		} catch {
			// cache may not exist — that's fine
		}
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		try {
			await unlink(CACHE_PATH);
		} catch {
			// already cleaned up — that's fine
		}
	});

	it("discovers models via OpenAI /v1/models endpoint", async () => {
		mockFetchWith({
			"/v1/models": () => json({ data: [{ id: "llama3:8b", object: "model" }] }),
			"/api/show": () =>
				json({
					capabilities: ["vision"],
					model_info: { "llama3:8b.context_length": 65536 },
				}),
		});

		const result = await discoverModels(makeConfig());
		assert.strictEqual(result.source, "live-openai");
		assert.strictEqual(result.models.length, 1);
		assert.strictEqual(result.models[0].id, "llama3:8b");
		assert.strictEqual(result.models[0].contextWindow, 65536);
		assert.ok((result.models[0].input as string[]).includes("image"));
	});

	it("falls back to native /api/tags when OpenAI returns empty list", async () => {
		mockFetchWith({
			"/v1/models": () => json({ data: [] }),
			"/api/tags": () => json({ models: [{ name: "qwen2:7b" }] }),
			"/api/show": () =>
				json({
					capabilities: ["thinking"],
					model_info: { "qwen2:7b.context_length": 32768 },
				}),
		});

		const result = await discoverModels(makeConfig());
		assert.strictEqual(result.source, "live-native");
		assert.strictEqual(result.models.length, 1);
		assert.strictEqual(result.models[0].id, "qwen2:7b");
		assert.strictEqual(result.models[0].reasoning, true);
	});

	it("rotates API keys on 401 and retries with next key", async () => {
		let v1Calls = 0;
		mockFetchWith({
			"/v1/models": () => {
				v1Calls++;
				if (v1Calls === 1) return new Response("Unauthorized", { status: 401 });
				return json({ data: [{ id: "llama3:8b", object: "model" }] });
			},
			"/api/show": () => json({ capabilities: [], model_info: {} }),
		});

		const config = makeConfig({ apiKey: "key1", apiKeys: ["key1", "key2"] });
		const result = await discoverModels(config);
		assert.strictEqual(result.source, "live-openai");
		assert.strictEqual(result.models.length, 1);
		assert.strictEqual(v1Calls, 2);
	});

	it("falls back to cache when both endpoints fail", async () => {
		await saveCache(
			{
				baseUrl: BASE,
				timestamp: Date.now() - 60_000,
				source: "live",
				models: [
					{
						id: "cached-model",
						name: "cached-model",
						reasoning: false,
						input: ["text"],
						contextWindow: 128000,
						maxTokens: 16384,
					},
				],
				enrichment: { attempted: 1, succeeded: 1, failed: 0 },
			},
			CACHE_PATH,
		);

		mockFetchWith({
			"/v1/models": () => new Response("error", { status: 500 }),
			"/api/tags": () => new Response("error", { status: 500 }),
		});

		const result = await discoverModels(makeConfig());
		assert.ok(result.source.startsWith("cache-"));
		assert.strictEqual(result.models.length, 1);
		assert.strictEqual(result.models[0].id, "cached-model");
		assert.ok(result.warnings?.length);
	});

	it("throws when both endpoints fail and no cache exists", async () => {
		mockFetchWith({
			"/v1/models": () => new Response("error", { status: 500 }),
			"/api/tags": () => new Response("error", { status: 500 }),
		});

		await assert.rejects(() => discoverModels(makeConfig()));
	});

	it("enriches models with vision and reasoning capabilities", async () => {
		mockFetchWith({
			"/v1/models": () =>
				json({
					data: [
						{ id: "model-a", object: "model" },
						{ id: "model-b", object: "model" },
					],
				}),
			"/api/show": (_url, init) => {
				const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
				if (body.model === "model-a") {
					return json({
						capabilities: ["vision"],
						model_info: { "model-a.context_length": 131072 },
					});
				}
				return json({
					capabilities: ["thinking"],
					model_info: { "model-b.context_length": 65536 },
				});
			},
		});

		const result = await discoverModels(makeConfig());
		const modelA = result.models.find((m) => m.id === "model-a")!;
		const modelB = result.models.find((m) => m.id === "model-b")!;

		assert.ok((modelA.input as string[]).includes("image"));
		assert.strictEqual(modelA.contextWindow, 131072);
		assert.strictEqual(modelB.reasoning, true);
		assert.strictEqual(modelB.contextWindow, 65536);
	});
});
