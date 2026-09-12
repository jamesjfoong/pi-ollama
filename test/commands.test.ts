import assert from "node:assert";
import { describe, it } from "node:test";
import { registerAccountCommand } from "../extensions/account-command";
import {
	doctorSummary,
	formatDuration,
	modelOption,
	modelTags,
	selectModel,
} from "../extensions/presentation";
import type {
	CommandContext,
	DiscoveryResult,
	ExtensionAPI,
	OllamaConfig,
} from "../extensions/types";

const config = (overrides: Partial<OllamaConfig> = {}): OllamaConfig => ({
	baseUrl: "http://localhost:19999",
	apiKey: "test-primary",
	api: "openai-completions",
	compat: {},
	authHeader: true,
	accounts: {
		personal: { apiKey: "test-personal" },
		work: { apiKey: "test-work" },
	},
	activeAccount: "personal",
	...overrides,
});

const result: DiscoveryResult = {
	source: "live-openai",
	models: [],
	enrichment: { attempted: 0, succeeded: 0, failed: 0 },
};

function context(
	notifications: string[],
	select: (options: string[]) => string | null = () => null,
): CommandContext {
	return {
		hasUI: true,
		ui: {
			input: async () => null,
			confirm: async () => false,
			select: async (_title, options) => select(options),
			notify: (message) => notifications.push(message),
		},
	};
}

function command() {
	let handler: ((args: unknown, ctx: CommandContext) => Promise<void>) | undefined;
	const pi = {
		registerCommand(_name: string, options: { handler: typeof handler }) {
			handler = options.handler;
		},
		registerProvider() {},
		registerCommandUnused() {},
		on() {},
	} as unknown as ExtensionAPI;
	return {
		pi,
		get handler() {
			assert.ok(handler);
			return handler;
		},
	};
}

describe("command presentation", () => {
	it("labels plain text models", () => {
		assert.strictEqual(modelTags({ reasoning: false, input: ["text"] }), "text-only");
	});

	it("formats elapsed durations", () => {
		assert.strictEqual(formatDuration(), "<1s");
		assert.strictEqual(formatDuration(1_000), "1s");
		assert.strictEqual(formatDuration(61_000), "1m 1s");
	});

	it("labels model picker options with searchable capabilities", () => {
		assert.strictEqual(
			modelOption({
				id: "qwen3:8b",
				name: "qwen3:8b",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 32768,
				maxTokens: 8192,
			}),
			"qwen3:8b · reasoning, vision · context=32,768",
		);
	});

	it("formats missing cache and discovery state", () => {
		const output = doctorSummary(config(), null, null);
		assert.ok(output.includes("│  Status        missing"));
		assert.ok(output.includes("│  Source        none"));
	});

	it("formats long cache age", () => {
		const output = doctorSummary(config(), result, {
			version: 1,
			baseUrl: config().baseUrl,
			timestamp: Date.now() - 61_000,
			source: "live",
			models: [],
			enrichment: { attempted: 0, succeeded: 0, failed: 0 },
		});
		assert.ok(output.includes("│  Age           1m 1s"));
	});

	it("selects the model matching picker option", async () => {
		const models = [
			{
				id: "qwen3:8b",
				name: "qwen3:8b",
				reasoning: true,
				input: ["text", "image"] as ["text", "image"],
				contextWindow: 32768,
				maxTokens: 8192,
			},
		];
		const selected = await selectModel(
			{
				hasUI: true,
				ui: {
					select: async (_title, options) => options[0],
					input: async () => "vision",
					confirm: async () => false,
					notify: () => {},
				},
			},
			"Pick",
			models,
		);
		assert.strictEqual(selected, models[0]);
	});

	it("returns no model when picker is cancelled", async () => {
		const selected = await selectModel(
			{
				hasUI: true,
				ui: {
					select: async () => null,
					input: async () => null,
					confirm: async () => false,
					notify: () => {},
				},
			},
			"Pick",
			[],
		);
		assert.strictEqual(selected, undefined);
	});

	it("formats doctor output into readable sections", () => {
		const output = doctorSummary(config(), result, {
			version: 1,
			baseUrl: config().baseUrl,
			timestamp: Date.now(),
			source: "live",
			models: [],
			enrichment: { attempted: 0, succeeded: 0, failed: 0 },
		});
		assert.ok(output.includes("┌─ [pi-ollama] Ollama Doctor"));
		assert.ok(output.includes("├─ Cache"));
		assert.ok(output.includes("├─ Discovery"));
		assert.ok(output.includes("│  Source        live-openai"));
	});
});

describe("account command", () => {
	it("selects account, persists selection, and refreshes models", async () => {
		const registered = command();
		const notifications: string[] = [];
		let saved: import("../extensions/types").PersistedConfig | undefined;
		let registeredModels = 0;
		let current: OllamaConfig | undefined;
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({ filter: "qwen" }),
			savePersistedConfig: async (value) => {
				saved = value;
			},
			resolveConfig: async () => config({ activeAccount: "work", apiKey: "test-work" }),
			discoverModels: async () => ({
				...result,
				models: [
					{
						id: "work-model",
						name: "work-model",
						reasoning: false,
						input: ["text"],
						contextWindow: 1,
						maxTokens: 1,
					},
				],
			}),
			registerProvider: () => {
				registeredModels += 1;
			},
			setCurrentConfig: (value) => {
				current = value;
			},
		});

		await registered.handler("work", context(notifications));
		assert.strictEqual(saved?.activeAccount, "work");
		assert.strictEqual(current?.activeAccount, "work");
		assert.strictEqual(registeredModels, 1);
		assert.ok(notifications[0].includes("Active account: work"));
	});

	it("uses legacy key pool when named accounts are absent", async () => {
		const registered = command();
		let savedAccount = "";
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({}),
			savePersistedConfig: async (value) => {
				savedAccount = String(value.activeAccount);
			},
			resolveConfig: async () =>
				config({ accounts: undefined, apiKeys: ["legacy-one", "legacy-two"] }),
			discoverModels: async () => result,
			registerProvider: () => {},
			setCurrentConfig: () => {},
		});
		await registered.handler("default", context([]));
		assert.strictEqual(savedAccount, "default");
	});

	it("uses UI selection when no argument is supplied", async () => {
		const registered = command();
		let selected: string[] = [];
		let savedAccount = "";
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({}),
			savePersistedConfig: async (value) => {
				savedAccount = String(value.activeAccount);
			},
			resolveConfig: async () => config(),
			discoverModels: async () => result,
			registerProvider: () => {},
			setCurrentConfig: () => {},
		});
		await registered.handler(
			"",
			context([], (options) => {
				selected = options;
				return "personal";
			}),
		);
		assert.deepStrictEqual(selected, ["personal", "work"]);
		assert.strictEqual(savedAccount, "personal");
	});

	it("rejects unknown account without persistence", async () => {
		const registered = command();
		const notifications: string[] = [];
		let writes = 0;
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({}),
			savePersistedConfig: async () => {
				writes += 1;
			},
			resolveConfig: async () => config(),
			discoverModels: async () => result,
			registerProvider: () => {},
			setCurrentConfig: () => {},
		});
		await registered.handler("missing", context(notifications));
		assert.strictEqual(writes, 0);
		assert.deepStrictEqual(notifications, ["[pi-ollama] Unknown account: missing"]);
	});

	it("rejects inherited property names without persistence", async () => {
		const registered = command();
		const notifications: string[] = [];
		let writes = 0;
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({}),
			savePersistedConfig: async () => {
				writes += 1;
			},
			resolveConfig: async () => config(),
			discoverModels: async () => result,
			registerProvider: () => {},
			setCurrentConfig: () => {},
		});
		await registered.handler("toString", context(notifications));
		assert.strictEqual(writes, 0);
		assert.deepStrictEqual(notifications, ["[pi-ollama] Unknown account: toString"]);
	});

	it("does nothing when selection is cancelled", async () => {
		const registered = command();
		let writes = 0;
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({}),
			savePersistedConfig: async () => {
				writes += 1;
			},
			resolveConfig: async () => config(),
			discoverModels: async () => result,
			registerProvider: () => {},
			setCurrentConfig: () => {},
		});
		await registered.handler(undefined, context([]));
		assert.strictEqual(writes, 0);
	});

	it("warns when refresh fails after saving account", async () => {
		const registered = command();
		const notifications: string[] = [];
		registerAccountCommand(registered.pi, {
			loadPersistedConfig: async () => ({}),
			savePersistedConfig: async () => {},
			resolveConfig: async () => config(),
			discoverModels: async () => {
				throw new Error("offline");
			},
			registerProvider: () => {},
			setCurrentConfig: () => {},
		});
		await registered.handler("personal", context(notifications));
		assert.ok(notifications[0].includes("refresh failed: offline"));
	});
});
