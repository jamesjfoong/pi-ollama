# How I Built pi-ollama: Auto-Discovering Ollama Models with Zero Build Steps

> **TL;DR:** I built a [pi extension](https://pi.dev) that eliminates `models.json` maintenance for Ollama users. It auto-discovers models on startup, handles multi-key auth rotation, and ships with an interactive TUI — all in ~800 lines of TypeScript with **zero runtime dependencies** and **no build step**.

---

## The Problem: Death by a Thousand `models.json` Edits

I use [Ollama](https://ollama.com) to run local LLMs and [pi](https://pi.dev) as my coding agent harness. The workflow was painful:

1. `ollama pull qwen2.5-coder:7b` — new model downloaded
2. Open `~/.pi/agent/models.json`
3. Add `{ "id": "qwen2.5-coder:7b" }` to the `ollama.models` array
4. Restart pi
5. Repeat every time I pull a new model

This doesn't scale. I pull models daily — new coding models, vision models, reasoning models. Editing JSON by hand and restarting my agent harness every time felt like a tax on experimentation.

**I wanted:** `ollama pull` → open pi → model is already there. No restart. No JSON.

---

## The Solution: A pi Extension That Talks to Ollama

pi has an [extension system](https://pi.dev/docs/extensions) that lets you register providers dynamically at runtime. The hook is simple:

```typescript
export default async function (pi: ExtensionAPI) {
	pi.registerProvider("ollama", {
		baseUrl: "http://localhost:11434",
		models: [
			/* discovered at runtime */
		],
	});
}
```

The challenge: **how do you discover models reliably across different Ollama setups?**

### Discovery Strategy

Ollama has two APIs:

- **OpenAI-compatible:** `GET /v1/models` — returns `{ data: [{ id, object: "model" }] }`
- **Native:** `GET /api/tags` — returns `{ models: [{ name }] }`

Some setups expose only one. Some are behind proxies. Some need auth. My discovery logic tries OpenAI-compat first, falls back to native, and handles both:

```typescript
async function discoverLive(config: OllamaConfig): Promise<DiscoveryResult> {
	// Try OpenAI-compatible endpoint first
	try {
		const ids = await discoverOpenAiModelIds(config);
		if (ids.length > 0) return { source: "live-openai", models: await enrich(config, ids) };
	} catch {
		/* fallback */
	}

	// Fall back to native Ollama API
	try {
		const ids = await discoverNativeModelIds(config);
		if (ids.length > 0) return { source: "live-native", models: await enrich(config, ids) };
	} catch {
		/* no luck */
	}

	throw new Error("Both endpoints failed");
}
```

### Non-Blocking Startup

Here's the key architectural decision: **pi startup should never be blocked by network I/O.**

I register from cache immediately (synchronous, never fails), then kick off live discovery in the background:

```typescript
// Register from cache immediately — pi startup is never blocked
const cache = await loadCache();
if (cache?.models?.length > 0) {
	registerProvider(pi, config, { source: "cache", models: cache.models });
}

// Background live discovery (non-blocking)
(async () => {
	const discovery = await discoverModels(config);
	registerProvider(pi, config, discovery); // updates provider with live data
})();
```

This means pi opens instantly with your last-known models, then silently refreshes when the live response comes in.

### Key Rotation

Some users run Ollama behind authenticated proxies with multiple API keys. I added automatic failover:

```typescript
async function tryWithKeyRotation<T>(
	config: OllamaConfig,
	operation: (keyIndex: number) => Promise<T>,
): Promise<T> {
	const keys = config.apiKeys ?? [config.apiKey];
	for (let i = 0; i < keys.length; i++) {
		try {
			return await operation(i);
		} catch (err) {
			if (!isAuthFailure(err) || i === keys.length - 1) throw err;
			// Auth failure — try next key
		}
	}
}
```

### Model Fixes

Ollama's `/api/show` metadata isn't always accurate. A model might claim vision support but fail on image input. I added a **guided fix system**:

- `/ollama-info` inspects a model's resolved capabilities
- `/ollama-fix` lets you override vision, reasoning, context window, thinking format
- Fixes persist in `~/.pi/agent/pi-ollama.json` as per-model overrides

You can also apply regex-based patterns (e.g., `.*qwen.*` → reasoning enabled) and global defaults.

---

## The Architecture: 800 Lines, Zero Dependencies

I kept it dependency-free (Node.js built-ins only). Here's the module map:

```
extensions/
├── index.ts         # Entry point — cache-first bootstrap + background discovery
├── discovery.ts     # HTTP discovery (/v1/models, /api/tags) + filtering
├── provider.ts      # Provider registration state management
├── config.ts        # Config resolution: env → file → models.json fallback → defaults
├── cache.ts         # Disk cache for offline fallback
├── overrides.ts     # Model override merge (global → patterns → exact)
├── commands.ts      # /ollama-setup, /ollama-refresh, /ollama-status, etc.
├── setup-wizard.ts  # Interactive TUI using pi's built-in select/input/confirm
├── logger.ts        # Debug-log toggle via PI_OLLAMA_DEBUG
└── types.ts         # Shared TypeScript interfaces
```

**Why no build step?** pi runs extensions via `tsx` (or ts-node), so `.ts` files execute directly. I added `tsconfig.json` for type-checking in CI, but the runtime needs zero compilation.

**Why zero runtime dependencies?** pi extensions execute in the user's Node process. Every dependency is a supply-chain risk and a potential breakage point. The only things in `devDependencies` are formatting, testing, and type-checking tools — none ship to users.

---

## The Test Strategy: Node's Built-in Test Runner

I skipped Jest/Vitest and used Node's native [`node:test`](https://nodejs.org/api/test.html) + `node:assert`. It runs without config files:

```bash
npx tsx --test test/*.test.ts
```

This keeps the devDependency footprint tiny: `tsx`, `c8` (coverage), `prettier`, and `@types/node`. That's it.

Key tests:

- **HTTP mocking:** Mock `globalThis.fetch` to test discovery without a running Ollama
- **Config resolution:** Test env var → file → fallback priority chain
- **Override merge:** Test global → pattern → exact precedence with invalid-value sanitization
- **Cache TTL:** Test fresh/stale boundaries and version mismatch rejection

---

## Lessons Learned

### 1. Design for failure

Discovery fails. Networks drop. Endpoints change. The extension never crashes pi — it warns and falls back to cache. Every `await` is wrapped in a try/catch that degrades gracefully.

### 2. Cache is not a luxury, it's a requirement

Without cache, a network hiccup means zero models and a broken workflow. With cache, you get slightly stale data but full functionality. I made cache the **primary** registration path and live discovery the background upgrade.

### 3. Interactive UX beats config files

I started with env vars and JSON editing. Then I built `/ollama-setup` — an arrow-key TUI that lets users pick endpoints, test connections, and save config without touching a file. Usage of `/ollama-setup` is 10× higher than manual config edits in my own workflow.

### 4. Keep the API surface tiny

The `ExtensionAPI` type in pi is deliberately minimal:

```typescript
interface ExtensionAPI {
	registerProvider(name: string, config: any): void;
	registerCommand(name: string, options: { description: string; handler: Function }): void;
	on(event: string, handler: Function): void;
}
```

You don't need a framework. You need `fetch`, `JSON.parse`, and a clean mental model of async flow.

---

## Try It

```bash
# Install globally
pi install npm:@jamesjfoong/pi-ollama

# Or test drive
pi -e npm:@jamesjfoong/pi-ollama
```

Then inside pi:

- `/ollama-status` — see what's loaded
- `/ollama-setup` — configure your endpoint
- `/ollama-refresh` — re-discover without restarting

---

## What's Next

I'm exploring:

- **Team model sharing:** Sync model overrides across a team via a shared config URL
- **Usage analytics:** Track which models get used most (locally, no telemetry sent anywhere)
- **Model recommendations:** Suggest models based on the task type (coding, vision, reasoning)

If you find this useful, [sponsoring the project](https://github.com/sponsors/jamesjfoong) helps me justify more time on it. Or just star the repo and open an issue — that's free and also appreciated.

---

**Repo:** https://github.com/jamesjfoong/pi-ollama  
**Package:** https://pi.dev/packages/@jamesjfoong/pi-ollama  
**Author:** [@jamesjfoong](https://github.com/jamesjfoong)
