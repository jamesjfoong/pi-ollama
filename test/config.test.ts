import assert from "node:assert";
import { describe, it } from "node:test";
import { DEFAULTS, DEFAULT_PREFIX } from "../extensions/constants";
import {
	resolveApiKeys,
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
});
