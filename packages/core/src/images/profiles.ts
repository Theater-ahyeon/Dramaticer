import type {
	BackgroundJob,
	BackgroundJobHandler,
} from "../background/types.js";
import { normalizeEntityName } from "../entity.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { LoreEntry } from "../memory/lore.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type CharacterVisualProfile,
	assertCharacterVisualProfile,
	assertUniqueVisualProfiles,
} from "./types.js";

export const VISUAL_PROFILE_JOB_KIND = "visual_profile";

export const MIN_VISUAL_PROFILES = 1;
export const MAX_VISUAL_PROFILES = 8;

/** 名称至少两个字符才按“正文里出现过”判定，单字名在任何句子里都会偶然命中。 */
const MIN_INLINE_NAME_CHARS = 2;

/** 校验视觉档案人物的依据：角色卡名、角色实体名称与别名，以及正文。 */
export interface VisualProfileKnownNames {
	readonly names: ReadonlySet<string>;
	readonly sourceText: string;
}

/** 人物名来自角色实体，或者出现在角色卡与常驻世界书正文里，就算已知。 */
export function isKnownVisualProfileName(
	known: VisualProfileKnownNames,
	name: string,
): boolean {
	const normalized = normalizeEntityName(name);
	if (normalized.length === 0) return false;
	if (known.names.has(normalized)) return true;
	if ([...normalized].length < MIN_INLINE_NAME_CHARS) return false;
	return normalizeEntityName(known.sourceText).includes(normalized);
}

/** 生成视觉档案需要的输入；素材不足时返回 null。 */
export interface VisualProfileInput {
	readonly cardName: string | null;
	readonly characterPrompt: string;
	readonly loreEntries: readonly LoreEntry[];
	/** 角色卡与实体表里的人物名，原样用于提示词。 */
	readonly characterNames: readonly string[];
	readonly knownNames: VisualProfileKnownNames;
}

/**
 * 收集生成视觉档案需要的输入。故事还没有角色卡与常驻世界书时返回 null；
 * 视觉档案只需要人物设定，不读楼层。
 */
export function collectVisualProfileInput(
	store: StoryStore,
	storyId: string,
): VisualProfileInput | null {
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const settings = store.getStorySettings(storyId);
	const characterPrompt = settings.characterPrompt ?? "";
	const loreEntries = store
		.listLoreEntries(storyId)
		.filter((entry) => entry.constant);
	if (characterPrompt.trim().length === 0 && loreEntries.length === 0) {
		return null;
	}
	const characters = store.listEntities(storyId, { kind: "character" });
	const names = new Set<string>();
	if (settings.cardName !== null) {
		names.add(normalizeEntityName(settings.cardName));
	}
	const characterNames: string[] = [];
	const seenNames = new Set<string>();
	const addCharacterName = (name: string): void => {
		const key = normalizeEntityName(name);
		if (key.length === 0 || seenNames.has(key)) return;
		seenNames.add(key);
		characterNames.push(name);
	};
	if (settings.cardName !== null) addCharacterName(settings.cardName);
	for (const entity of characters) {
		names.add(normalizeEntityName(entity.name));
		for (const alias of entity.aliases) names.add(normalizeEntityName(alias));
		addCharacterName(entity.name);
	}
	const sourceText = [
		characterPrompt,
		...loreEntries.map((entry) => entry.content),
	].join("\n");
	return {
		cardName: settings.cardName,
		characterPrompt,
		loreEntries,
		characterNames,
		knownNames: { names, sourceText },
	};
}

/** 校验单条视觉档案：字段形状之外还要求人物来自角色卡或实体。 */
export function validateVisualProfilePayload(
	value: unknown,
	knownNames: VisualProfileKnownNames,
	label = "视觉档案",
): CharacterVisualProfile {
	const profile = assertCharacterVisualProfile(value, label);
	if (!isKnownVisualProfileName(knownNames, profile.character)) {
		throw new Error(
			`${label}.character 不是角色卡或实体里的人物：${profile.character}`,
		);
	}
	return profile;
}

/** 解析模型返回的视觉档案；1 到 8 条，任何一条不合格都整包拒绝。 */
export function parseVisualProfilesResponse(
	text: string,
	knownNames: VisualProfileKnownNames,
): CharacterVisualProfile[] {
	const record = assertPlainObject(
		parseJsonOutputObject(text, "视觉档案"),
		"视觉档案",
	);
	rejectUnknownKeys(record, ["profiles"], "视觉档案");
	if (!Array.isArray(record.profiles)) {
		throw new Error("视觉档案.profiles 必须是数组");
	}
	if (
		record.profiles.length < MIN_VISUAL_PROFILES ||
		record.profiles.length > MAX_VISUAL_PROFILES
	) {
		throw new Error(
			`视觉档案.profiles 必须有 ${MIN_VISUAL_PROFILES} 到 ${MAX_VISUAL_PROFILES} 条，实际为 ${record.profiles.length} 条`,
		);
	}
	const profiles = record.profiles.map((item, index) =>
		validateVisualProfilePayload(
			item,
			knownNames,
			`视觉档案.profiles[${index}]`,
		),
	);
	assertUniqueVisualProfiles(profiles, "视觉档案.profiles");
	return profiles;
}

const SYSTEM_PROMPT = [
	"你是角色视觉设定师。根据角色卡、世界书常驻设定与已知人物名，为故事里的主要人物建立生图用的视觉档案。",
	`- profiles：${MIN_VISUAL_PROFILES} 到 ${MAX_VISUAL_PROFILES} 条，每条对应一个人物。人物名必须是角色卡、实体或世界书里出现过的名字，不要临时编造，也不要为同一个人物写两条。`,
	"- base：3 到 8 个基础外貌标签，描述发型、发色、瞳色、体型、气质等稳定特征，每个标签是一个短语。",
	"- defaultOutfit：默认服装，一句话或一组标签。",
	"- negative：这个人物需要避免的画风或特征标签，可以是空数组。",
	"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如：",
	'{"profiles":[{"character":"…","base":["…","…"],"defaultOutfit":"…","negative":["…"]}]}',
].join("\n");

/** 把角色卡、常驻世界书与已知人物名拼成用户消息。 */
export function buildVisualProfileUserContent(
	input: VisualProfileInput,
): string {
	const lines: string[] = [];
	lines.push("角色卡：");
	if (input.cardName !== null) lines.push(`名称：${input.cardName}`);
	lines.push(
		input.characterPrompt.trim().length === 0
			? "（没有正文）"
			: input.characterPrompt,
	);
	if (input.loreEntries.length === 0) {
		lines.push("", "世界书常驻条目：无。");
	} else {
		lines.push("", "世界书常驻条目：");
		for (const entry of input.loreEntries) {
			lines.push(`<条目 name="${entry.name}">`);
			lines.push(entry.content);
			lines.push("</条目>");
		}
	}
	lines.push("", "已知人物名：");
	lines.push(
		input.characterNames.length === 0
			? "（没有显式列出，按角色卡与世界书正文判断）"
			: input.characterNames.join("、"),
	);
	return lines.join("\n");
}

export interface VisualProfileHandlerOptions {
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

/**
 * 视觉档案的后台任务：模型输出严格 JSON，整包校验通过后按人物覆盖同一行。
 * 自动入队由 needsRun 控制档案表为空；同一个处理器也可以被手动重新生成调用。
 */
export function createVisualProfileHandler(
	options: VisualProfileHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const input = collectVisualProfileInput(store, job.storyId);
		if (input === null) return;
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildVisualProfileUserContent(input) },
		];
		const result = await client.complete(
			{
				messages,
				model: options.model,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		const profiles = parseVisualProfilesResponse(result.text, input.knownNames);
		store.saveCharacterVisualProfiles({
			storyId: job.storyId,
			profiles,
			source: "model",
		});
	};
}

/** 入队条件为 story：有角色卡或常驻世界书，并且档案表为空。 */
export function visualProfileNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const input = collectVisualProfileInput(store, storyId);
	if (input === null) return false;
	return store.listCharacterVisualProfiles(storyId).length === 0;
}

/** 故事创建与导入卡之后入队视觉档案任务；不需要时返回空数组。 */
export function enqueueVisualProfileBackgroundJob(
	store: StoryStore,
	storyId: string,
): BackgroundJob[] {
	if (!visualProfileNeedsRun(store, storyId)) return [];
	return store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [VISUAL_PROFILE_JOB_KIND],
	});
}
