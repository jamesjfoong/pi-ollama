import assert from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
	getCacheAgeMs,
	getCacheTtlMs,
	isCacheFresh,
	loadCache,
	saveCache,
} from "../extensions/cache";

let tempDir: string | undefined;

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
	if ("OLLAMA_CACHE_TTL_MS" in process.env) delete process.env.OLLAMA_CACHE_TTL_MS;
	if ("OLLAMA_CACHE_TTL_MIN" in process.env) delete process.env.OLLAMA_CACHE_TTL_MIN;
});

async function tmpPath(name = "cache.json") {
	tempDir ??= await mkdtemp(join(tmpdir(), "pi-ollama-test-"));
	return join(tempDir, name);
}

const makeCache = (overrides: Record<string, unknown> = {}) => ({
	version: 1,
	baseUrl: "http://localhost:11434",
	timestamp: Date.now(),
	source: "live" as const,
	models: [
		{
			id: "llama3:8b",
			name: "llama3:8b",
			reasoning: false,
			input: ["text"] as ["text"],
			contextWindow: 128000,
			maxTokens: 16384,
		},
	],
	enrichment: { attempted: 1, succeeded: 1, failed: 0 },
	...overrides,
});

describe("cache", () => {
	describe("getCacheTtlMs", () => {
		it("defaults to 15 minutes", () => {
			assert.strictEqual(getCacheTtlMs(), 15 * 60_000);
		});

		it("respects OLLAMA_CACHE_TTL_MS", () => {
			process.env.OLLAMA_CACHE_TTL_MS = "60000";
			assert.strictEqual(getCacheTtlMs(), 60_000);
		});

		it("falls back to default on invalid value", () => {
			process.env.OLLAMA_CACHE_TTL_MS = "not-a-number";
			assert.strictEqual(getCacheTtlMs(), 15 * 60_000);
		});
	});

	describe("getCacheAgeMs / isCacheFresh", () => {
		it("fresh cache is fresh", () => {
			const cache = makeCache({ timestamp: Date.now() });
			assert.ok(isCacheFresh(cache));
		});

		it("old cache is stale", () => {
			const cache = makeCache({ timestamp: Date.now() - 20 * 60_000 });
			assert.ok(!isCacheFresh(cache));
		});

		it("age is never negative", () => {
			const cache = makeCache({ timestamp: Date.now() + 5000 });
			assert.strictEqual(getCacheAgeMs(cache), 0);
		});
	});

	describe("saveCache + loadCache", () => {
		it("roundtrips data correctly", async () => {
			const path = await tmpPath();
			await saveCache(
				{
					baseUrl: "http://test",
					timestamp: 1000,
					source: "live",
					models: [],
					enrichment: { attempted: 0, succeeded: 0, failed: 0 },
				},
				path,
			);
			const loaded = await loadCache(path);
			assert.ok(loaded);
			assert.strictEqual(loaded.baseUrl, "http://test");
			assert.strictEqual(loaded.timestamp, 1000);
		});

		it("returns null for missing file", async () => {
			const result = await loadCache(await tmpPath("nope.json"));
			assert.strictEqual(result, null);
		});

		it("returns null for wrong version", async () => {
			const path = await tmpPath();
			const { writeFileSync } = await import("node:fs");
			writeFileSync(path, JSON.stringify({ version: 999, models: [], timestamp: 1 }));
			assert.strictEqual(await loadCache(path), null);
		});

		it("returns null for corrupt JSON", async () => {
			const path = await tmpPath();
			const { writeFileSync } = await import("node:fs");
			writeFileSync(path, "not json");
			assert.strictEqual(await loadCache(path), null);
		});
	});
});
