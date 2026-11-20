import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type JsonValue,
	type StoryStore,
	applyCardRecommendedConfig,
	isJsonObject,
	parseCardRecommendedConfig,
	parseDramaticerCardExtension,
	readLoreCopy,
	readMemorySecrets,
	readStoryCardSnapshot,
	readStoryFeatureState,
	saveStoryCardSnapshot,
	saveWritingPreset,
	storyCardVersion,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	importCharacterBookLore,
	mapPresetToWritingDials,
	parseCharacterCardJson,
	parseCharacterCardPng,
	parsePresetJson,
	worldInfoFromCharacterBook,
} from "@dramaticer/st-compat";
import { sendJson } from "./http.js";
import {
	fieldError,
	readObjectBody,
	requireMethod,
	requireStory,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";

/** 每个功能开关每轮在后台大约多花的 token；只用于设置页的合计。 */
const FEATURE_COSTS: Readonly<Record<string, number>> = {
	scribe: 600,
	archive: 200,
	search: 100,
	prepare: 900,
	choices: 120,
	tools: 300,
};

function parseCard(payload: unknown): { card: StCharacterCard; data: string } {
	if (!isJsonObject(payload) || typeof payload.data !== "string") {
		throw fieldError("card", "必须提供卡片内容");
	}
	try {
		const card =
			payload.format === "png"
				? parseCharacterCardPng(Buffer.from(payload.data, "base64"))
				: parseCharacterCardJson(payload.data);
		return { card, data: payload.data };
	} catch (error) {
		throw fieldError(
			"card",
			error instanceof Error ? error.message : String(error),
		);
	}
}

function keywordsMatch(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) return false;
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.every((item, index) => item === sortedRight[index]);
}

/** 升级差异比名称、正文、常驻与关键词；顺序不影响判断。 */
function sameCardLoreEntry(
	existing: {
		readonly name: string;
		readonly content: string;
		readonly constant: boolean;
		readonly keywords: readonly string[];
	},
	incoming: {
		readonly name: string;
		readonly content: string;
		readonly constant: boolean;
		readonly keywords: readonly string[];
	},
): boolean {
	return (
		existing.name === incoming.name &&
		existing.content.trim() === incoming.content &&
		existing.constant === incoming.constant &&
		keywordsMatch(existing.keywords, incoming.keywords)
	);
}

/**
 * 载入卡之后：记下故事固定的卡版本，并记下卡带的推荐配置。
 * 写法只能由玩家切换（I6），卡推荐的三档写法只供界面展示；
 * 写作选项与功能开关的推荐只在第一次载入时应用，之后玩家的选择不被覆盖；
 * 升级只更新推荐本身，「回到推荐」时才重新应用。
 */
export function afterCardImport(
	store: StoryStore,
	storyId: string,
	card: StCharacterCard,
	data: string,
): void {
	const firstLoad = readStoryCardSnapshot(store, storyId) === null;
	const extension = parseDramaticerCardExtension(card.extensions.dramaticer);
	const config = extension.config ?? null;
	const recommendation = parseCardRecommendedConfig(config);
	saveStoryCardSnapshot(store, storyId, {
		name: card.name,
		version: storyCardVersion(data),
		recommendedMode: recommendation.mode,
	});
	applyCardRecommendedConfig(store, storyId, config, {
		applySettings: firstLoad,
	});
}

export async function handleCardRoute(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
	parts: readonly string[],
): Promise<boolean> {
	const [, , third, fourth] = parts;
	const store = options.store;

	if (third === "card" && parts.length === 3) {
		requireMethod(method, ["GET"]);
		requireStory(options.store, storyId);
		const card = readStoryCardSnapshot(store, storyId);
		sendJson(res, 200, {
			storyId,
			card,
			recommendedMode: card?.recommendedMode ?? null,
		});
		return true;
	}

	if (third === "card" && fourth === "diff" && parts.length === 4) {
		requireMethod(method, ["POST"]);
		requireStory(options.store, storyId);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		const { card, data } = parseCard(body.card);
		const current = readStoryCardSnapshot(store, storyId);
		const same = current !== null && current.version === storyCardVersion(data);
		const incoming = new Map<
			string,
			{
				name: string;
				content: string;
				constant: boolean;
				keywords: readonly string[];
			}
		>();
		if (card.characterBook !== null) {
			for (const entry of worldInfoFromCharacterBook(
				card.characterBook,
				card.name,
			).entries) {
				if (entry.disabled || entry.content.trim() === "") continue;
				incoming.set(`character-book:${card.name}:${entry.sourceKey}`, {
					name: entry.comment || entry.keys[0] || entry.sourceKey,
					content: entry.content.trim(),
					constant: entry.constant,
					keywords: [...entry.keys],
				});
			}
		}
		const copy = readLoreCopy(store, storyId).filter((item) =>
			item.original.source.startsWith("character-book:"),
		);
		const known = new Map(
			copy.map((item) => [item.original.source, item] as const),
		);
		const added: string[] = [];
		const changed: string[] = [];
		const head = store.getHead(storyId)?.id ?? null;
		for (const [source, entry] of incoming) {
			const existing = known.get(source);
			if (existing === undefined) {
				added.push(entry.name);
				continue;
			}
			// 和故事里现在生效的条目比；上次升级叠上去的修改也算。
			if (sameCardLoreEntry(existing.entry, entry)) continue;
			changed.push(existing.entry.name);
			// 升级时把新版内容叠到副本上；玩家锁定的条目保持玩家的内容。
			if (body.apply === true && !existing.locked) {
				store.savePlayerEdit({
					storyId,
					nodeId: head,
					kind: "lore",
					target: existing.original.id,
					value: {
						name: entry.name,
						content: entry.content,
						constant: entry.constant,
						keywords: [...entry.keywords],
					},
					source: "ai",
					note: "卡升级到新版",
				});
			}
		}
		const removed = copy
			.filter((item) => !incoming.has(item.original.source))
			.map((item) => item.original.name);
		if (body.apply === true) {
			if (card.characterBook !== null) {
				importCharacterBookLore(store, storyId, card.characterBook, card.name);
			}
			for (const item of copy) {
				if (incoming.has(item.original.source)) continue;
				if (item.locked || item.disabled) continue;
				store.savePlayerEdit({
					storyId,
					nodeId: head,
					kind: "lore",
					target: item.original.id,
					value: {
						name: item.entry.name,
						content: item.entry.content,
						constant: item.entry.constant,
						keywords: [...item.entry.keywords],
					},
					disabled: true,
					source: "ai",
					note: "卡升级后不再包含这条",
				});
			}
			afterCardImport(store, storyId, card, data);
		}
		sendJson(res, 200, { storyId, same, added, changed, removed });
		return true;
	}

	if (third === "writing" && fourth === "preset" && parts.length === 4) {
		requireMethod(method, ["POST"]);
		requireStory(options.store, storyId);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		if (typeof body.preset !== "string")
			throw fieldError("preset", "必须提供预设文件的内容");
		let result: ReturnType<typeof mapPresetToWritingDials>;
		try {
			result = mapPresetToWritingDials(
				parsePresetJson(body.preset),
				typeof body.name === "string" ? body.name : "预设",
			);
		} catch (error) {
			throw fieldError(
				"preset",
				error instanceof Error ? error.message : String(error),
			);
		}
		const view = saveWritingPreset(
			store,
			storyId,
			result.mapping,
			result.dials,
		);
		sendJson(res, 200, view);
		return true;
	}

	if (third === "features" && fourth === "stats" && parts.length === 4) {
		requireMethod(method, ["GET"]);
		requireStory(options.store, storyId);
		sendJson(res, 200, {
			storyId,
			costs: FEATURE_COSTS,
			uses: featureUses(store, storyId),
		});
		return true;
	}

	return false;
}

/** 每项功能起过几次作用；只统计读得到、算得快的几项。 */
function featureUses(
	store: StoryStore,
	storyId: string,
): Record<string, string> {
	const uses: Record<string, string> = {};
	const head = store.getHead(storyId);
	if (head === null) return uses;
	const path = store.getPathToNode(head.id);
	const assistants = path.filter((node) => node.role === "assistant");
	let scribed = 0;
	for (const node of assistants.slice(-200)) {
		if (store.getSceneLog(node.id) !== null) scribed += 1;
	}
	uses.scribe = `记了 ${scribed} 楼`;
	uses.archive = `${store.listSceneArchivesAlongPath(head.id).length} 场`;
	const decisions = store.getDirectorDecisionsAlongPath(head.id);
	const arranged = decisions.filter(
		(decision) => decision.directive !== null,
	).length;
	const muted = store.listMutedDirectorLines(storyId).length;
	uses.director = `安排过 ${arranged} 次，你撤回 ${muted} 次`;
	uses.knows = `标了 ${readMemorySecrets(store, storyId).length} 条`;
	uses.choices = `你点过 ${store.listPreferenceEvents(storyId, { kind: "choice" }).length} 次`;
	const prepared = assistants.filter(
		(node) => store.getTurnTrace(node.id)?.plan?.prepared === true,
	).length;
	const planned = assistants.filter(
		(node) => store.getTurnTrace(node.id)?.plan !== undefined,
	).length;
	if (planned > 0) uses.prepare = `命中 ${prepared} / ${planned} 次`;
	const writing = store
		.listImportAuditInjectionRules(storyId)
		.filter((rule) => rule.kind === "writing" && rule.memory !== true).length;
	if (writing > 0) uses.style = `每轮带 ${writing} 条文风`;
	// 关着的开关不显示「起过作用」，免得看起来还在生效（refactor/02）。
	const values = readStoryFeatureState(store, storyId).values as Readonly<
		Record<string, unknown>
	>;
	for (const id of Object.keys(uses)) {
		const value = values[id];
		if (value === false || value === "off" || value === 0) delete uses[id];
	}
	return uses;
}

export type { JsonValue };
