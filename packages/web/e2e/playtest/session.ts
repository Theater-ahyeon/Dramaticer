import { DatabaseSync } from "node:sqlite";
import type { Page } from "@playwright/test";
import type {
	PlaytestDirectorRecord,
	PlaytestPreferenceCounts,
} from "../../src/playtest/records";
import { PLAYTEST_PREFERENCE_KINDS } from "../../src/playtest/records";

export interface PlaytestFloor {
	readonly id: string;
	readonly parentId: string | null;
	readonly role: "user" | "assistant";
	readonly raw: string;
	readonly createdAt: string;
}

export interface PlaytestPathView {
	readonly headNodeId: string | null;
	readonly nodes: readonly PlaytestFloor[];
	readonly hasMore: boolean;
}

interface PlaytestTreeView {
	readonly headNodeId: string | null;
	readonly nodes: readonly {
		readonly id: string;
		readonly parentId: string | null;
		readonly role: "user" | "assistant";
		readonly preview: string;
	}[];
}

interface PlaytestTraceView {
	readonly turnMode: string;
	readonly llm: {
		readonly usage: {
			readonly promptTokens: number | null;
			readonly completionTokens: number | null;
			readonly totalTokens: number | null;
			readonly reasoningTokens: number | null;
		};
	};
	readonly timing: {
		readonly firstTokenMs: number | null;
		readonly durationMs: number;
	};
}

interface PlaytestLedgerView {
	readonly diffs: readonly unknown[];
}

interface PlaytestDirectorView {
	readonly decision: {
		readonly directive: string | null;
		readonly mechanisms: readonly {
			readonly name: string;
			readonly triggered: boolean;
			readonly reason: string;
		}[];
	} | null;
}

interface PlaytestActionsView {
	readonly actions: readonly {
		readonly id: string;
		readonly kind: string;
		readonly text: string;
	}[];
}

interface PlaytestCluesView {
	readonly clues: readonly { readonly id: string; readonly text?: string }[];
}

interface PlaytestJobsView {
	readonly counts: {
		readonly pending: number;
		readonly running: number;
		readonly failed: number;
		readonly done: number;
		readonly discarded: number;
	};
}

export interface PlaytestOpeningView {
	readonly candidates: readonly { readonly id: string; readonly raw: string }[];
}

interface PlaytestEntitiesView {
	readonly entities: readonly {
		readonly kind: string;
		readonly name: string;
	}[];
}

async function getJson<T>(page: Page, path: string): Promise<T> {
	const response = await page.request.get(path);
	if (!response.ok()) {
		throw new Error(
			`GET ${path} 返回 ${response.status()}：${(await response.text()).slice(0, 200)}`,
		);
	}
	return (await response.json()) as T;
}

export async function fetchPath(
	page: Page,
	storyId: string,
	options: { readonly nodeId?: string; readonly limit?: number } = {},
): Promise<PlaytestPathView> {
	const params = new URLSearchParams();
	params.set("limit", String(options.limit ?? 200));
	if (options.nodeId !== undefined) params.set("nodeId", options.nodeId);
	return getJson<PlaytestPathView>(
		page,
		`/api/stories/${storyId}/path?${params.toString()}`,
	);
}

export async function fetchTree(
	page: Page,
	storyId: string,
): Promise<PlaytestTreeView> {
	return getJson<PlaytestTreeView>(page, `/api/stories/${storyId}/tree`);
}

export async function fetchNode(
	page: Page,
	storyId: string,
	nodeId: string,
): Promise<PlaytestFloor> {
	const view = await fetchPath(page, storyId, { nodeId, limit: 1 });
	const node = view.nodes.at(-1);
	if (node === undefined || node.id !== nodeId) {
		throw new Error(`接口没有返回楼层 ${nodeId}`);
	}
	return node;
}

export async function fetchTrace(
	page: Page,
	nodeId: string,
): Promise<PlaytestTraceView | null> {
	const response = await page.request.get(`/api/nodes/${nodeId}/trace`);
	if (response.status() === 404) return null;
	if (!response.ok()) {
		throw new Error(`GET /api/nodes/${nodeId}/trace 返回 ${response.status()}`);
	}
	return (await response.json()) as PlaytestTraceView;
}

export async function fetchLedgerDiffCount(
	page: Page,
	nodeId: string,
): Promise<number> {
	const view = await getJson<PlaytestLedgerView>(
		page,
		`/api/nodes/${nodeId}/ledger`,
	);
	return view.diffs.length;
}

/** 导演决策写在生成时的消息楼层上；助手楼层自己的决策通常为空。 */
export async function fetchDirector(
	page: Page,
	nodeId: string,
): Promise<PlaytestDirectorRecord | null> {
	const view = await getJson<PlaytestDirectorView>(
		page,
		`/api/nodes/${nodeId}/director`,
	);
	if (view.decision === null) return null;
	return {
		directive: view.decision.directive,
		mechanisms: view.decision.mechanisms.map((mechanism) => ({
			name: mechanism.name,
			triggered: mechanism.triggered,
			reason: mechanism.reason,
		})),
	};
}

export async function fetchCandidateActions(
	page: Page,
	nodeId: string,
): Promise<PlaytestActionsView["actions"]> {
	const view = await getJson<PlaytestActionsView>(
		page,
		`/api/nodes/${nodeId}/actions`,
	);
	return view.actions;
}

export async function fetchOpenClueIds(
	page: Page,
	storyId: string,
): Promise<Set<string>> {
	const view = await getJson<PlaytestCluesView>(
		page,
		`/api/stories/${storyId}/clues`,
	);
	return new Set(view.clues.map((clue) => clue.id));
}

export async function fetchOpeningCandidates(
	page: Page,
	storyId: string,
): Promise<PlaytestOpeningView> {
	return getJson<PlaytestOpeningView>(
		page,
		`/api/stories/${storyId}/openings?status=pending`,
	);
}

export async function fetchCharacterNames(
	page: Page,
	storyId: string,
): Promise<string[]> {
	const view = await getJson<PlaytestEntitiesView>(
		page,
		`/api/stories/${storyId}/entities`,
	);
	return view.entities
		.filter((entity) => entity.kind === "character")
		.map((entity) => entity.name);
}

export async function fetchJobCounts(
	page: Page,
	storyId: string,
): Promise<PlaytestJobsView["counts"]> {
	const view = await getJson<PlaytestJobsView>(
		page,
		`/api/stories/${storyId}/jobs`,
	);
	return view.counts;
}

/**
 * 等本轮触发的后台任务跑完再采样；超出等待时间时返回当前计数，
 * 不把后台未完成当成试玩失败。
 */
export async function waitForBackgroundIdle(
	page: Page,
	storyId: string,
	timeoutMs: number,
): Promise<PlaytestJobsView["counts"]> {
	const deadline = Date.now() + timeoutMs;
	let counts = await fetchJobCounts(page, storyId);
	while ((counts.pending > 0 || counts.running > 0) && Date.now() < deadline) {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 500);
		await promise;
		counts = await fetchJobCounts(page, storyId);
	}
	return counts;
}

export function readPreferenceCounts(dbPath: string, storyId: string) {
	const counts: Record<string, number> = {};
	for (const kind of PLAYTEST_PREFERENCE_KINDS) counts[kind] = 0;
	const db = new DatabaseSync(dbPath, { timeout: 5_000 });
	try {
		const rows = db
			.prepare(
				"SELECT kind, COUNT(*) AS count FROM preference_events WHERE story_id = ? GROUP BY kind",
			)
			.all(storyId) as { kind: string; count: number }[];
		for (const row of rows) counts[row.kind] = Number(row.count);
	} finally {
		db.close();
	}
	return {
		swipe: counts.swipe ?? 0,
		choice: counts.choice ?? 0,
		edit: counts.edit ?? 0,
		card_decision: counts.card_decision ?? 0,
	} satisfies PlaytestPreferenceCounts;
}
