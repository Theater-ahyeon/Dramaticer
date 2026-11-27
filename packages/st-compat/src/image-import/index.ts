import { randomUUID } from "node:crypto";
import {
	type StoryStore,
	type TagLibraryEntryInput,
	type WritingEntry,
	readWritingEntries,
	writeWritingEntries,
} from "@dramaticer/core";
import {
	type ParsedImageCharacterLibrary,
	parseImageCharacterLibrary,
} from "./characters.js";
import { parseImagePromptPreset } from "./prompts.js";

export * from "./characters.js";
export * from "./prompts.js";

export interface ImageCharacterLibraryImportResult {
	readonly profiles: number;
	readonly outfits: number;
}

export interface ImagePromptPresetImportResult {
	readonly tagEntries: number;
	readonly writingEntries: number;
}

/** 把角色 / 服装库解析结果写进故事：同人物覆盖档案，服装按人物与名称更新。 */
export function importImageCharacterLibrary(
	store: StoryStore,
	storyId: string,
	input: unknown,
): ImageCharacterLibraryImportResult {
	const parsed: ParsedImageCharacterLibrary = parseImageCharacterLibrary(input);
	if (parsed.profiles.length === 0) {
		throw new Error("角色库文件里没有可导入的角色");
	}
	store.saveCharacterVisualProfiles({
		storyId,
		profiles: parsed.profiles,
		source: "import",
	});
	for (const outfit of parsed.outfits) {
		store.upsertCharacterOutfit({ ...outfit, storyId });
	}
	return { profiles: parsed.profiles.length, outfits: parsed.outfits.length };
}

/**
 * 把生图提示词预设写进故事：关键词条目追加到标签库，
 * 其余条目追加到画面整理写作条目。正文回合的写作条目保持不变。
 */
export function importImagePromptPreset(
	store: StoryStore,
	storyId: string,
	input: unknown,
): ImagePromptPresetImportResult {
	const parsed = parseImagePromptPreset(input);
	const now = new Date().toISOString();
	if (parsed.tags.length > 0) {
		const existingTags = store
			.listTagLibraryEntries(storyId)
			.filter((entry) => entry.scope === "story")
			.map((entry): TagLibraryEntryInput => ({ ...entry }));
		const additions: TagLibraryEntryInput[] = parsed.tags.map((entry) => ({
			...entry,
			id: randomUUID(),
			storyId,
			scope: "story",
			createdAt: now,
			updatedAt: now,
		}));
		store.replaceTagLibraryEntries({
			storyId,
			entries: [...existingTags, ...additions],
		});
	}
	if (parsed.writingEntries.length > 0) {
		const existing = readWritingEntries(store, storyId);
		const baseOrder = existing.length;
		const additions: WritingEntry[] = parsed.writingEntries.map(
			(entry, index) => ({
				id: randomUUID(),
				name: entry.name,
				content: entry.content,
				role: "system",
				placement: "after-history",
				depth: 0,
				order: baseOrder + index,
				enabled: entry.enabled,
				scope: "image_organizer",
			}),
		);
		writeWritingEntries(store, storyId, [...existing, ...additions]);
	}
	return {
		tagEntries: parsed.tags.length,
		writingEntries: parsed.writingEntries.length,
	};
}
