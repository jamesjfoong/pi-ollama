import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULTS, DEFAULT_PREFIX } from "../extensions/constants";
import {
	loadModelsJsonFallback,
	loadPersistedConfig,
	normalizeBaseUrl,
	resolveAccounts,
	resolveConfig,
	resolveApiKeys,
	savePersistedConfig,
	resolveBaseUrl,
	resolvePrefix,
	resolveSingleKey,
	stripTrailingSlash,
} from "../extensions/config";

describe("config", () => {
	describe("stripTrailingSlash", () => {
		it("removes a single trailing slash", () => {
			assert.strictEqual(stripTrailingSlash("http://localhost/"), "http://localhost");
		});

		it("leaves slash-less URLs untouched", () => {
			assert.strictEqual(stripTrailingSlash("http://localhost"), "http://localhost");
		});

		it("removes only the last slash", () => {
			assert.strictEqual(stripTrailingSlash("http://localhost/v1/"), "http://localhost/v1");
		});
	});

	describe("resolveBaseUrl", () => {
		it("uses the default when input is undefined", () => {
			assert.strictEqual(resolveBaseUrl(undefined), DEFAULTS.baseUrl);
		});

		it("strips trailing slash from input", () => {
			assert.strictEqual(resolveBaseUrl("http://host:1234/"), "http://host:1234");
		});

		it("preserves /v1 suffix", () => {
			assert.strictEqual(resolveBaseUrl("https://ollama.com/v1"), "https://ollama.com/v1");
		});

		it("strips trailing slash but preserves /v1", () => {
			assert.strictEqual(resolveBaseUrl("https://ollama.com/v1/"), "https://ollama.com/v1");
		});

		it("preserves /v1 in nested paths", () => {
			assert.strictEqual(resolveBaseUrl("http://host/api/v1"), "http://host/api/v1");
		});
	});

	describe("normalizeBaseUrl", () => {
		it("removes legacy API prefix from persisted base URL", () => {
			assert.strictEqual(
				normalizeBaseUrl("http://localhost:11434/v1", "/v1"),
				"http://localhost:11434",
			);
		});

		it("preserves root URL when prefix is absent", () => {
			assert.strictEqual(
				normalizeBaseUrl("http://localhost:11434", "/v1"),
				"http://localhost:11434",
			);
		});
	});

	describe("resolveAccounts", () => {
		it("wraps legacy keys in default account without changing values", () => {
			assert.deepStrictEqual(resolveAccounts({ apiKey: "key1", apiKeys: ["key1", "key2"] }, {}), {
				accounts: { default: { apiKey: "key1", apiKeys: ["key1", "key2"] } },
				activeAccount: "default",
			});
		});

		it("uses selected named account", () => {
			assert.deepStrictEqual(
				resolveAccounts(
					{
						activeAccount: "work",
						accounts: { personal: { apiKey: "p" }, work: { apiKey: "w" } },
					},
					{},
				),
				{
					accounts: { personal: { apiKey: "p" }, work: { apiKey: "w" } },
					activeAccount: "work",
				},
			);
		});

		it("falls back to first named account when active account is invalid", () => {
			const result = resolveAccounts(
				{ activeAccount: "missing", accounts: { zeta: { apiKey: "z" }, alpha: { apiKey: "a" } } },
				{},
			);
			assert.strictEqual(result.activeAccount, "alpha");
		});
	});

	describe("resolvePrefix", () => {
		it("uses the default when input is undefined", () => {
			assert.strictEqual(resolvePrefix(undefined), DEFAULT_PREFIX);
		});

		it("uses the default when input is empty string", () => {
			assert.strictEqual(resolvePrefix(""), "");
		});

		it("returns custom prefix", () => {
			assert.strictEqual(resolvePrefix("/api/v1"), "/api/v1");
		});

		it("returns /v1 when explicitly set", () => {
			assert.strictEqual(resolvePrefix("/v1"), "/v1");
		});
	});

	describe("resolveSingleKey", () => {
		it("uses the default when input is empty", () => {
			assert.strictEqual(resolveSingleKey(undefined), DEFAULTS.apiKey);
		});

		it("returns literal key prefixed with !", () => {
			assert.strictEqual(resolveSingleKey("!secret"), "secret");
		});

		it("resolves env var when name matches", () => {
			process.env.TEST_API_KEY = "from-env";
			assert.strictEqual(resolveSingleKey("TEST_API_KEY"), "from-env");
			delete process.env.TEST_API_KEY;
		});

		it("falls back to default when env var is empty", () => {
			process.env.EMPTY_KEY = "";
			assert.strictEqual(resolveSingleKey("EMPTY_KEY"), DEFAULTS.apiKey);
			delete process.env.EMPTY_KEY;
		});

		it("returns literal value when no env var matches", () => {
			assert.strictEqual(resolveSingleKey("hardcoded-key"), "hardcoded-key");
		});
	});

	describe("resolveApiKeys", () => {
		it("returns default key when input is empty", () => {
			assert.deepStrictEqual(resolveApiKeys(undefined), [DEFAULTS.apiKey]);
		});

		it("supports single key", () => {
			assert.deepStrictEqual(resolveApiKeys("key1"), ["key1"]);
		});

		it("supports comma-separated keys", () => {
			assert.deepStrictEqual(resolveApiKeys("key1,key2,key3"), ["key1", "key2", "key3"]);
		});

		it("supports array input", () => {
			assert.deepStrictEqual(resolveApiKeys(["a", "b"]), ["a", "b"]);
		});

		it("strips whitespace from comma-separated keys", () => {
			assert.deepStrictEqual(resolveApiKeys(" key1 , key2 "), ["key1", "key2"]);
		});

		it("resolves env vars in comma-separated list", () => {
			process.env.KEY_A = "resolved-a";
			process.env.KEY_B = "resolved-b";
			assert.deepStrictEqual(resolveApiKeys("KEY_A,KEY_B"), ["resolved-a", "resolved-b"]);
			delete process.env.KEY_A;
			delete process.env.KEY_B;
		});
	});

	describe("config file helpers", () => {
		it("load missing files as empty config", async () => {
			const dir = await mkdtemp(join(tmpdir(), "pi-ollama-config-"));
			try {
				assert.deepStrictEqual(await loadPersistedConfig(join(dir, "missing.json")), {});
				assert.deepStrictEqual(await loadModelsJsonFallback(join(dir, "missing-models.json")), {});
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});

		it("saves and loads persisted config atomically", async () => {
			const dir = await mkdtemp(join(tmpdir(), "pi-ollama-config-"));
			const path = join(dir, "nested", "config.json");
			try {
				await savePersistedConfig({ apiKey: "saved-key" }, path);
				assert.deepStrictEqual(await loadPersistedConfig(path), {
					apiKey: "saved-key",
					version: 1,
				});
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});

		it("reads legacy models.json fallback", async () => {
			const dir = await mkdtemp(join(tmpdir(), "pi-ollama-config-"));
			const path = join(dir, "models.json");
			try {
				await writeFile(
					path,
					JSON.stringify({
						providers: { ollama: { baseUrl: "http://fallback", apiKey: "fallback-key" } },
					}),
				);
				assert.deepStrictEqual(await loadModelsJsonFallback(path), {
					baseUrl: "http://fallback",
					apiKey: "fallback-key",
					apiKeys: undefined,
					api: undefined,
					compat: undefined,
					authHeader: undefined,
				});
				const config = await resolveConfig({
					configPath: join(dir, "missing-config.json"),
					modelsJsonPath: path,
					env: {},
				});
				assert.strictEqual(config.apiKey, "fallback-key");
				assert.strictEqual(config.baseUrl, "http://fallback");
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});
	});

	describe("resolveConfig", () => {
		it("resolves named account and environment override", async () => {
			const dir = await mkdtemp(join(tmpdir(), "pi-ollama-config-"));
			const path = join(dir, "config.json");
			try {
				await writeFile(
					path,
					JSON.stringify({ activeAccount: "work", accounts: { work: { apiKey: "work-key" } } }),
				);
				const config = await resolveConfig({ configPath: path, env: {} });
				assert.strictEqual(config.activeAccount, "work");
				assert.strictEqual(config.apiKey, "work-key");
				const overridden = await resolveConfig({
					configPath: path,
					env: { OLLAMA_API_KEY: "env-key" },
				});
				assert.strictEqual(overridden.apiKey, "env-key");

				for (const persisted of [
					{ apiKeys: ["persisted-array"] },
					{ apiKey: "persisted-single" },
				]) {
					await writeFile(path, JSON.stringify(persisted));
					const resolved = await resolveConfig({ configPath: path, env: {} });
					const value = Object.values(persisted)[0];
					assert.strictEqual(resolved.apiKey, Array.isArray(value) ? value[0] : value);
				}

				const modelsPath = join(dir, "models.json");
				await writeFile(
					modelsPath,
					JSON.stringify({ providers: { ollama: { apiKeys: ["fallback-array"] } } }),
				);
				let resolved = await resolveConfig({
					configPath: join(dir, "missing.json"),
					modelsJsonPath: modelsPath,
					env: {},
				});
				assert.strictEqual(resolved.apiKey, "fallback-array");
				await writeFile(
					modelsPath,
					JSON.stringify({ providers: { ollama: { apiKey: "fallback-single" } } }),
				);
				resolved = await resolveConfig({
					configPath: join(dir, "missing.json"),
					modelsJsonPath: modelsPath,
					env: {},
				});
				assert.strictEqual(resolved.apiKey, "fallback-single");
				await writeFile(
					path,
					JSON.stringify({ accounts: { work: {} }, apiKeys: ["legacy-array"] }, null, 2),
				);
				resolved = await resolveConfig({ configPath: path, env: {} });
				assert.strictEqual(resolved.apiKey, "legacy-array");
				await writeFile(
					path,
					JSON.stringify({ accounts: { work: {} }, apiKey: "legacy-single" }, null, 2),
				);
				resolved = await resolveConfig({ configPath: path, env: {} });
				assert.strictEqual(resolved.apiKey, "legacy-single");
				await writeFile(path, JSON.stringify({ accounts: { work: {} } }, null, 2));
				await writeFile(
					modelsPath,
					JSON.stringify({ providers: { ollama: { apiKeys: ["fallback-account-array"] } } }),
				);
				resolved = await resolveConfig({ configPath: path, modelsJsonPath: modelsPath, env: {} });
				assert.strictEqual(resolved.apiKey, "fallback-account-array");
				await writeFile(
					modelsPath,
					JSON.stringify({ providers: { ollama: { apiKey: "fallback-account-single" } } }),
				);
				resolved = await resolveConfig({ configPath: path, modelsJsonPath: modelsPath, env: {} });
				assert.strictEqual(resolved.apiKey, "fallback-account-single");
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		});
	});
});
