import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CACHE_VERSION, CACHE_PATH } from "./constants";
import type { DiscoveredModel, EnrichmentStats } from "./types";

export interface ModelCache {
	version: number;
	baseUrl: string;
	timestamp: number;
	source: "live" | "cache";
	models: DiscoveredModel[];
	enrichment: EnrichmentStats;
}

export function getCacheTtlMs(): number {
	const ttlMs = Number(process.env.OLLAMA_CACHE_TTL_MS || "");
	if (Number.isFinite(ttlMs) && ttlMs > 0) return ttlMs;

	const ttlMin = Number(process.env.OLLAMA_CACHE_TTL_MIN || "");
	if (Number.isFinite(ttlMin) && ttlMin > 0) return ttlMin * 60_000;

	return 15 * 60_000;
}

export async function loadCache(path: string = CACHE_PATH): Promise<ModelCache | null> {
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as ModelCache;
		if (parsed.version !== CACHE_VERSION) return null;
		if (!Array.isArray(parsed.models) || !parsed.timestamp) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function saveCache(
	data: Omit<ModelCache, "version">,
	path: string = CACHE_PATH,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpFile = `${path}.tmp`;
	await writeFile(tmpFile, JSON.stringify({ version: CACHE_VERSION, ...data }, null, 2));
	await rename(tmpFile, path);
}

export function getCacheAgeMs(cache: ModelCache): number {
	return Math.max(0, Date.now() - cache.timestamp);
}

export function isCacheFresh(cache: ModelCache): boolean {
	return getCacheAgeMs(cache) <= getCacheTtlMs();
}
