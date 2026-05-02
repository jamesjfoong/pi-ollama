import { resolveBaseUrl, resolvePrefix } from "./config";
import { discoverModels } from "./discovery";
import type { CommandContext, OllamaConfig } from "./types";

function maskSecret(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "*".repeat(value.length);
	const visible = Math.min(6, Math.max(2, Math.floor(value.length / 4)));
	return `${value.slice(0, visible)}***`;
}

function keyDisplay(config: OllamaConfig): string {
	const keys = config.apiKeys ?? [config.apiKey];
	if (keys.length <= 1) return maskSecret(keys[0] ?? "");
	const first = maskSecret(keys[0]);
	return `${first} (+${keys.length - 1} more)`;
}

function buildMenuOptions(working: OllamaConfig): string[] {
	return [
		`Base URL     : ${working.baseUrl}`,
		`Prefix       : ${working.prefix || "/v1"}`,
		`API Key      : ${keyDisplay(working)}`,
		`Auth Header  : ${working.authHeader ? "on" : "off"}`,
		`Filter       : ${working.filter || "(none)"}`,
		"Test connection",
		"Save & discover",
		"Cancel",
	];
}

/**
 * Interactive config menu using TUI select for keyboard navigation.
 * Returns the updated config, or `null` if the user cancelled.
 */
export async function runSetupWizard(
	ctx: CommandContext,
	current: OllamaConfig,
): Promise<OllamaConfig | null> {
	const working = { ...current };

	while (true) {
		const options = buildMenuOptions(working);
		const choice = await ctx.ui.select("Ollama Setup — ↑↓ to navigate, Enter to pick", options);
		if (choice === null) return null;

		// Determine choice by matching against generated label
		// (strings include current values so we compare by prefix)
		if (choice.startsWith("Base URL")) {
			const picked = await ctx.ui.select("Pick endpoint", [
				`Keep current (${working.baseUrl})`,
				"Local Ollama (http://localhost:11434)",
				"Ollama Cloud (https://ollama.com)",
				"Custom...",
			]);
			if (picked === null) break;
			if (picked.startsWith("Keep current")) {
				// no-op
			} else if (picked.startsWith("Local")) {
				working.baseUrl = "http://localhost:11434";
				working.prefix = "/v1";
			} else if (picked.startsWith("Ollama Cloud")) {
				working.baseUrl = "https://ollama.com";
				working.prefix = "/v1";
			} else {
				// Custom
				const custom = await ctx.ui.input("Enter custom Ollama Base URL", working.baseUrl);
				if (custom !== null) {
					working.baseUrl = resolveBaseUrl(custom || working.baseUrl);
				}
			}
		} else if (choice.startsWith("API Key")) {
			const raw = await ctx.ui.input(
				"API Key(s) — comma-separated for rotation, leave empty to keep current",
				keyDisplay(working),
			);
			if (raw !== null) {
				if (raw.includes(",")) {
					// Comma-separated multi-key mode
					working.apiKeys = raw
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
					working.apiKey = working.apiKeys[0] || working.apiKey;
				} else if (raw.trim()) {
					// Single key mode
					working.apiKey = raw.trim();
					working.apiKeys = undefined;
				}
				// If empty, keep existing keys
			}
		} else if (choice.startsWith("Prefix")) {
			const custom = await ctx.ui.input(
				"Enter API path prefix (e.g. /v1, /api/v1, or empty)",
				working.prefix || "/v1",
			);
			if (custom !== null) {
				working.prefix = resolvePrefix(custom);
			}
		} else if (choice.startsWith("Auth Header")) {
			const authHeader = await ctx.ui.confirm(
				"Auth Header",
				`Send Authorization: Bearer header? Currently: ${working.authHeader ? "on" : "off"}`,
			);
			working.authHeader = authHeader;
		} else if (choice.startsWith("Filter")) {
			const filter = await ctx.ui.input("Model filter regex (optional)", working.filter || "");
			if (filter !== null) {
				working.filter = filter || undefined;
			}
		} else if (choice === "Test connection") {
			ctx.ui.notify("[pi-ollama] Testing…", "info");
			try {
				const discovery = await discoverModels(working);
				ctx.ui.notify(
					`[pi-ollama] ✓ ${discovery.models.length} models found (${discovery.source})`,
					"success",
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`[pi-ollama] ✗ ${msg.slice(0, 120)}`, "warning");
			}
		} else if (choice === "Save & discover") {
			return working;
		} else if (choice === "Cancel") {
			return null;
		}
	}

	return null;
}
