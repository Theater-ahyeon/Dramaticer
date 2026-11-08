import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	PREFERENCE_EVENT_KINDS,
	type PreferenceEvent,
	type PreferenceEventKind,
	type StoryStore,
	readOptionLines,
} from "@dramaticer/core";

/** 接受与放弃的两侧；选项没有独立楼层，`nodeId` 为 null。 */
export interface PreferencePairSide {
	readonly nodeId: string | null;
	readonly text: string;
}

/**
 * 一组可以两两对比的偏好样本。`reroll` 的两侧都是助手楼层，
 * `choice` 的两侧都是同一个选项块里的正文。
 */
export interface PreferencePair {
	readonly storyId: string;
	readonly kind: "reroll" | "choice";
	readonly sourceEventId: string;
	readonly anchorNodeId: string;
	readonly createdAt: string;
	readonly accepted: PreferencePairSide;
	readonly abandoned: PreferencePairSide;
}

export interface StoryPreferenceExport {
	readonly storyId: string;
	readonly eventsPath: string;
	readonly pairsPath: string;
	readonly eventCount: number;
	readonly pairCount: number;
	readonly unpairedChoices: number;
	readonly kindCounts: Readonly<Record<PreferenceEventKind, number>>;
}

export interface PreferencesExportResult {
	readonly outDir: string;
	readonly stories: readonly StoryPreferenceExport[];
	readonly eventCount: number;
	readonly pairCount: number;
	readonly unpairedChoices: number;
}

export interface ExportPreferencesOptions {
	readonly outDir: string;
	/** 只导出这个故事的记录；不指定时导出库里的全部故事。 */
	readonly story?: string | null;
}

/**
 * 按故事把偏好记录与回复对写成 JSONL。记录只追加，导出结果只由库内容决定：
 * 同一份库重复导出得到逐字节相同的文件。
 */
export function exportPreferences(
	store: StoryStore,
	options: ExportPreferencesOptions,
): PreferencesExportResult {
	const stories = store.listStories();
	if (options.story != null) {
		if (!stories.some((story) => story.id === options.story)) {
			throw new Error(`故事不存在：${options.story}`);
		}
	}
	const selected =
		options.story == null
			? stories
			: stories.filter((story) => story.id === options.story);
	const bases = new Map<string, string>();
	for (const story of selected) {
		const base = preferencesFileBase(story.id);
		const existing = bases.get(base);
		if (existing !== undefined) {
			throw new Error(
				`故事 ${existing} 与 ${story.id} 导出到同一个文件名 ${base}.jsonl，请先重命名其中一个故事`,
			);
		}
		bases.set(base, story.id);
	}
	mkdirSync(options.outDir, { recursive: true });
	const exports: StoryPreferenceExport[] = [];
	for (const story of selected) {
		const events = store.listPreferenceEvents(story.id);
		if (events.length === 0) continue;
		const base = bases.get(preferencesFileBase(story.id)) as string;
		const { pairs, unpairedChoices } = buildPreferencePairs(
			store,
			story.id,
			events,
		);
		const eventsPath = path.join(options.outDir, `${base}.events.jsonl`);
		const pairsPath = path.join(options.outDir, `${base}.pairs.jsonl`);
		writeFileSync(
			eventsPath,
			events.map((event) => `${JSON.stringify(event)}\n`).join(""),
			"utf8",
		);
		writeFileSync(
			pairsPath,
			pairs.map((pair) => `${JSON.stringify(pair)}\n`).join(""),
			"utf8",
		);
		exports.push({
			storyId: story.id,
			eventsPath,
			pairsPath,
			eventCount: events.length,
			pairCount: pairs.length,
			unpairedChoices,
			kindCounts: countKinds(events),
		});
	}
	const index = {
		stories: exports.map((entry) => ({
			storyId: entry.storyId,
			eventsFile: path.basename(entry.eventsPath),
			pairsFile: path.basename(entry.pairsPath),
			eventCount: entry.eventCount,
			pairCount: entry.pairCount,
			unpairedChoices: entry.unpairedChoices,
			kinds: entry.kindCounts,
		})),
		eventCount: exports.reduce((total, entry) => total + entry.eventCount, 0),
		pairCount: exports.reduce((total, entry) => total + entry.pairCount, 0),
		unpairedChoices: exports.reduce(
			(total, entry) => total + entry.unpairedChoices,
			0,
		),
	};
	writeFileSync(
		path.join(options.outDir, "index.json"),
		`${JSON.stringify(index, null, 2)}\n`,
		"utf8",
	);
	return {
		outDir: options.outDir,
		stories: exports,
		eventCount: index.eventCount,
		pairCount: index.pairCount,
		unpairedChoices: index.unpairedChoices,
	};
}

/** 把记录拆成两两对比的样本；编辑与变更卡决定不是胜负样本。 */
export function buildPreferencePairs(
	store: StoryStore,
	storyId: string,
	events: readonly PreferenceEvent[],
): {
	readonly pairs: readonly PreferencePair[];
	readonly unpairedChoices: number;
} {
	const pairs: PreferencePair[] = [];
	let unpairedChoices = 0;
	for (const event of events) {
		if (event.kind === "swipe") {
			const payload = event.payload as {
				readonly abandonedNodeId: string;
				readonly acceptedNodeId: string;
			};
			const accepted = store.getNode(payload.acceptedNodeId);
			if (accepted === null) {
				throw new Error(
					`偏好记录 ${event.id} 引用的楼层不存在：${payload.acceptedNodeId}`,
				);
			}
			const abandoned = store.getNode(payload.abandonedNodeId);
			if (abandoned === null) {
				throw new Error(
					`偏好记录 ${event.id} 引用的楼层不存在：${payload.abandonedNodeId}`,
				);
			}
			pairs.push({
				storyId,
				kind: "reroll",
				sourceEventId: event.id,
				anchorNodeId: event.nodeId,
				createdAt: event.createdAt,
				accepted: { nodeId: accepted.id, text: accepted.raw },
				abandoned: { nodeId: abandoned.id, text: abandoned.raw },
			});
			continue;
		}
		if (event.kind === "choice") {
			const payload = event.payload as { readonly choiceText: string };
			const anchor = store.getNode(event.nodeId);
			if (anchor === null) {
				throw new Error(
					`偏好记录 ${event.id} 引用的楼层不存在：${event.nodeId}`,
				);
			}
			const options = readOptionLines(anchor.raw);
			if (!options.includes(payload.choiceText)) {
				unpairedChoices += 1;
				continue;
			}
			const abandoned = [
				...new Set(options.filter((option) => option !== payload.choiceText)),
			];
			if (abandoned.length === 0) {
				unpairedChoices += 1;
				continue;
			}
			for (const text of abandoned) {
				pairs.push({
					storyId,
					kind: "choice",
					sourceEventId: event.id,
					anchorNodeId: event.nodeId,
					createdAt: event.createdAt,
					accepted: { nodeId: null, text: payload.choiceText },
					abandoned: { nodeId: null, text },
				});
			}
		}
	}
	return { pairs, unpairedChoices };
}

/**
 * 楼层 id 充当文件名；替换 Windows 不允许的字符，并给保留名加前缀。
 * 两个故事撞名时由 `exportPreferences` 抛错，不覆盖已有文件。
 */
export function preferencesFileBase(storyId: string): string {
	const disallowed = new Set('<>:"/\\|?*');
	let cleaned = "";
	for (const char of storyId) {
		cleaned += disallowed.has(char) || char.charCodeAt(0) < 0x20 ? "_" : char;
	}
	const base = cleaned.replace(/[. ]+$/g, "");
	return base.length === 0
		? "_"
		: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)
			? `_${base}`
			: base;
}

function countKinds(
	events: readonly PreferenceEvent[],
): Record<PreferenceEventKind, number> {
	const counts = Object.fromEntries(
		PREFERENCE_EVENT_KINDS.map((kind) => [kind, 0]),
	) as Record<PreferenceEventKind, number>;
	for (const event of events) {
		counts[event.kind] += 1;
	}
	return counts;
}
