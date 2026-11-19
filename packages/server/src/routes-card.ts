import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type FeatureSwitchOverrides,
	type JsonValue,
	type StoryStore,
	isFeatureTier,
	isJsonObject,
	readEffectiveEdits,
	readLoreCopy,
	readMemorySecrets,
	saveRecommendedWriting,
	saveWritingPreset,
} from "@dramaticer/core";
import {
	type StCharacterCard,
	mapPresetToWritingDials,
	parseCharacterCardJson,
	parseCharacterCardPng,
	parsePresetJson,
	worldInfoFromCharacterBook,
} from "@dramaticer/st-compat";
import { sendJson } from "./http.js";
import { allow, bad, readObject, requireStory } from "./routes-next.js";
import type { ApiRouteOptions } from "./routes.js";

const CARD_KEY = "card";

/** 每个功能开关每轮在后台大约多花的 token；只用于设置页的合计。 */
const FEATURE_COSTS: Readonly<Record<string, number>> = {
	scribe: 600,
	archive: 200,
	search: 100,
	prepare: 900,
	choices: 120,
	tools: 300,
};

function cardVersion(data: string): string {
	return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function parseCard(payload: unknown): { card: StCharacterCard; data: string } {
	if (!isJsonObject(payload) || typeof payload.data !== "string") {
		throw bad("card", "必须提供卡片内容");
	}
	try {
		const card =
			payload.format === "png"
				? parseCharacterCardPng(Buffer.from(payload.data, "base64"))
				: parseCharacterCardJson(payload.data);
		return { card, data: payload.data };
	} catch (error) {
		throw bad("card", error instanceof Error ? error.message : String(error));
	}
}

/**
 * 载入卡之后：记下故事固定的卡版本，并应用卡带的推荐配置。
 * 推荐的写法与档位只在第一次载入时应用，之后玩家的选择不被覆盖。
 */
export function afterCardImport(
	store: StoryStore,
	storyId: string,
	card: StCharacterCard,
	data: string,
): void {
	const first = store.getStoryValue(storyId, CARD_KEY) === null;
	const extension = card.extensions.dramaticer;
	const config =
		isJsonObject(extension) && isJsonObject(extension.config)
			? extension.config
			: null;
	store.setStoryValue(storyId, CARD_KEY, {
		name: card.name,
		version: cardVersion(data),
		importedAt: new Date().toISOString(),
		recommendedMode:
			typeof config?.turnMode === "string" ? config.turnMode : null,
	});
	saveRecommendedWriting(store, storyId, config?.writing ?? null);
	if (!first || config === null) return;
	try {
		if (config.turnMode === "plan") {
			store.setStoryValue(storyId, "writingMode", "plan");
		} else if (config.turnMode === "deep" || config.turnMode === "fast") {
			store.updateStorySettings(storyId, { turnMode: config.turnMode });
		}
		const features = isJsonObject(config.features) ? config.features : null;
		if (features !== null) {
			store.updateStorySettings(storyId, {
				...(isFeatureTier(features.tier) ? { featureTier: features.tier } : {}),
				...(isJsonObject(features.switches)
					? { featureSwitches: features.switches as FeatureSwitchOverrides }
					: {}),
			});
		}
	} catch {
		// 卡里写错的推荐值不让导入失败：推荐只是起点，玩家可以自己调。
	}
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
		allow(method, ["GET"]);
		requireStory(options, storyId);
		const card = store.getStoryValue(storyId, CARD_KEY);
		sendJson(res, 200, {
			storyId,
			card: isJsonObject(card) ? card : null,
			recommendedMode:
				isJsonObject(card) && typeof card.recommendedMode === "string"
					? card.recommendedMode
					: null,
		});
		return true;
	}

	if (third === "card" && fourth === "diff" && parts.length === 4) {
		allow(method, ["POST"]);
		requireStory(options, storyId);
		const body = await readObject(req, options);
		const { card, data } = parseCard(body.card);
		const current = store.getStoryValue(storyId, CARD_KEY);
		const same = isJsonObject(current) && current.version === cardVersion(data);
		const incoming = new Map<string, { name: string; content: string }>();
		if (card.characterBook !== null) {
			for (const entry of worldInfoFromCharacterBook(
				card.characterBook,
				card.name,
			).entries) {
				if (entry.disabled || entry.content.trim() === "") continue;
				incoming.set(`character-book:${card.name}:${entry.sourceKey}`, {
					name: entry.comment || entry.keys[0] || entry.sourceKey,
					content: entry.content.trim(),
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
			if (existing.original.content.trim() === entry.content) continue;
			changed.push(existing.original.name);
			// 升级时把新版内容叠到副本上；玩家锁定的条目保持玩家的内容。
			if (body.apply === true && !existing.locked) {
				store.savePlayerEdit({
					storyId,
					nodeId: head,
					kind: "lore",
					target: existing.original.id,
					value: {
						name: existing.entry.name,
						content: entry.content,
						constant: existing.entry.constant,
						keywords: [...existing.entry.keywords],
					},
					source: "ai",
					note: "卡升级到新版",
				});
			}
		}
		const removed = copy
			.filter((item) => !incoming.has(item.original.source))
			.map((item) => item.original.name);
		sendJson(res, 200, { storyId, same, added, changed, removed });
		return true;
	}

	if (third === "writing" && fourth === "preset" && parts.length === 4) {
		allow(method, ["POST"]);
		requireStory(options, storyId);
		const body = await readObject(req, options);
		if (typeof body.preset !== "string")
			throw bad("preset", "必须提供预设文件的内容");
		let result: ReturnType<typeof mapPresetToWritingDials>;
		try {
			result = mapPresetToWritingDials(
				parsePresetJson(body.preset),
				typeof body.name === "string" ? body.name : "预设",
			);
		} catch (error) {
			throw bad(
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
		allow(method, ["GET"]);
		requireStory(options, storyId);
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
	const loreEdits = readEffectiveEdits(store, storyId, null, "lore").size;
	if (loreEdits > 0) uses.style = `你改过 ${loreEdits} 条设定`;
	return uses;
}

export type { JsonValue };
