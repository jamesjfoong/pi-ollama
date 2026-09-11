import type {
	CommandContext,
	DiscoveryResult,
	ExtensionAPI,
	OllamaConfig,
	PersistedConfig,
} from "./types";

export interface AccountCommandDeps {
	loadPersistedConfig: () => Promise<PersistedConfig>;
	savePersistedConfig: (config: PersistedConfig) => Promise<void>;
	resolveConfig: () => Promise<OllamaConfig>;
	discoverModels: (config: OllamaConfig) => Promise<DiscoveryResult>;
	registerProvider: (pi: ExtensionAPI, config: OllamaConfig, result: DiscoveryResult) => void;
	setCurrentConfig: (config: OllamaConfig) => void;
}

export function registerAccountCommand(pi: ExtensionAPI, deps: AccountCommandDeps): void {
	pi.registerCommand("ollama-account", {
		description: "Select the active Ollama account",
		handler: async (args: unknown, ctx: CommandContext) => {
			const config = await deps.resolveConfig();
			const accounts = config.accounts ?? {
				default: { apiKey: config.apiKey, apiKeys: config.apiKeys },
			};
			const names = Object.keys(accounts).sort();
			const requested = typeof args === "string" ? args.trim() : "";
			const choice =
				requested || (ctx.hasUI ? await ctx.ui.select("Select Ollama account", names) : null);
			if (!choice) return;
			if (!(choice in accounts)) {
				ctx.ui.notify(`[pi-ollama] Unknown account: ${choice}`, "error");
				return;
			}

			const persisted = await deps.loadPersistedConfig();
			await deps.savePersistedConfig({ ...persisted, accounts, activeAccount: choice });
			const next = await deps.resolveConfig();
			deps.setCurrentConfig(next);
			try {
				const discovery = await deps.discoverModels(next);
				deps.registerProvider(pi, next, discovery);
				ctx.ui.notify(
					`[pi-ollama] Active account: ${choice}; ${discovery.models.length} models refreshed`,
					"success",
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(
					`[pi-ollama] Active account: ${choice}; refresh failed: ${msg.slice(0, 120)}`,
					"warning",
				);
			}
		},
	});
}
