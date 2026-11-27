import type {
	BackgroundJob,
	BackgroundJobHandler,
} from "../background/types.js";
import { normalizeEntityName } from "../entity.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { JsonObject } from "../json.js";
import type { LlmClient, LlmMessage } from "../llm/types.js";
import { NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import { readNotebookPages } from "../memory/notebook.js";
import type { NotebookPage } from "../memory/notebook.js";
import { renderWorldIndex } from "../memory/situation.js";
import { readWritingEntries } from "../settings/writing-entries.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import { finalizeImagePrompt, finalizeImageTags } from "./compile.js";
import { expandVisualProfile } from "./expand.js";
import type { CharacterOutfit } from "./outfits.js";
import { selectCharacterOutfit } from "./outfits.js";
import { DEFAULT_IMAGE_NEGATIVE_TAGS } from "./prompt.js";
import type { ImagePromptRequest } from "./prompt.js";
import { enqueueIllustrateBackgroundJob } from "./queue.js";
import {
	type TagLibraryGroup,
	groupTagLibraryEntries,
	matchTagLibraryEntries,
} from "./tags.js";
import type {
	CharacterVisualProfile,
	ImageConfig,
	ImageReplacementRule,
	ImageTrigger,
} from "./types.js";

export const IMAGE_ORGANIZER_JOB_KIND = "image_organize";

const ORGANIZE_REQUEST_KEY = "images.organizeRequests";

export const MAX_ORGANIZER_TITLE_CHARS = 60;
export const MAX_ORGANIZER_SCENE_CHARS = 500;
export const MAX_ORGANIZER_COMPOSITION_CHARS = 300;
export const MAX_ORGANIZER_ACTION_CHARS = 200;
export const MAX_ORGANIZER_NEGATIVE_CHARS = 500;
export const MAX_ORGANIZER_CHARACTERS = 4;

export const IMAGE_ORGANIZER_ANGLES = ["front", "back"] as const;
export type ImageOrganizerAngle = (typeof IMAGE_ORGANIZER_ANGLES)[number];

export const IMAGE_ORGANIZER_BODIES = ["face", "upper", "full"] as const;
export type ImageOrganizerBody = (typeof IMAGE_ORGANIZER_BODIES)[number];

export const IMAGE_ORGANIZER_EXPOSURES = ["clothed", "bare", "hidden"] as const;
export type ImageOrganizerExposure = (typeof IMAGE_ORGANIZER_EXPOSURES)[number];

export interface ImageOrganizerCenter {
	readonly x: number;
	readonly y: number;
}

export interface ImageOrganizerCharacter {
	readonly name: string;
	readonly angle: ImageOrganizerAngle;
	readonly body: ImageOrganizerBody;
	readonly exposure: ImageOrganizerExposure;
	readonly outfitName: string | null;
	readonly action: string | null;
	readonly negative: string | null;
	readonly center: ImageOrganizerCenter | null;
}

export interface ImageOrganizerImage {
	readonly insertAfterParagraph: number;
	readonly title: string;
	readonly scene: string;
	readonly composition: string;
	readonly characters: readonly ImageOrganizerCharacter[];
	readonly negativePrompt: string | null;
}

export interface ExpandedOrganizerCharacter {
	readonly name: string;
	readonly prompt: string;
	readonly negative: string;
	readonly center: ImageOrganizerCenter | null;
	readonly outfitId: string | null;
}

export interface ExpandedOrganizerImage {
	readonly insertAfterParagraph: number;
	readonly title: string;
	readonly prompt: string;
	readonly negativePrompt: string;
	readonly characters: readonly ExpandedOrganizerCharacter[];
}

/** 存进 `node_images.organizer_result` 的完整结果；重试与重绘都复用它。 */
export interface ImageOrganizerResult {
	readonly images: readonly ImageOrganizerImage[];
	readonly expanded: readonly ExpandedOrganizerImage[];
}

function requireText(value: unknown, label: string, maxChars: number): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	const text = value.trim();
	if (text.length > maxChars) {
		throw new Error(
			`${label} 最多 ${maxChars} 个字符，实际为 ${text.length} 个`,
		);
	}
	return text;
}

function optionalText(
	value: unknown,
	label: string,
	maxChars: number,
): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串或 null`);
	}
	const text = value.trim();
	if (text.length === 0) return null;
	if (text.length > maxChars) {
		throw new Error(
			`${label} 最多 ${maxChars} 个字符，实际为 ${text.length} 个`,
		);
	}
	return text;
}

function requireEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	label: string,
): T {
	if (
		typeof value !== "string" ||
		!(allowed as readonly string[]).includes(value)
	) {
		throw new Error(`${label} 只能是 ${allowed.join("、")}`);
	}
	return value as T;
}

function assertCenter(
	value: unknown,
	label: string,
): ImageOrganizerCenter | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} 必须是 {x, y} 对象或 null`);
	}
	const record = value as Record<string, unknown>;
	rejectUnknownKeys(record, ["x", "y"], label);
	const x = record.x;
	const y = record.y;
	if (
		typeof x !== "number" ||
		!Number.isFinite(x) ||
		x < 0 ||
		x > 1 ||
		typeof y !== "number" ||
		!Number.isFinite(y) ||
		y < 0 ||
		y > 1
	) {
		throw new Error(`${label}.x 与 y 必须是 0 到 1 之间的数字`);
	}
	return { x, y };
}

function assertOrganizerCharacter(
	value: unknown,
	label: string,
): ImageOrganizerCharacter {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(
		record,
		[
			"name",
			"angle",
			"body",
			"exposure",
			"outfitName",
			"action",
			"negative",
			"center",
		],
		label,
	);
	return {
		name: requireText(record.name, `${label}.name`, 80),
		angle: requireEnum(record.angle, IMAGE_ORGANIZER_ANGLES, `${label}.angle`),
		body: requireEnum(record.body, IMAGE_ORGANIZER_BODIES, `${label}.body`),
		exposure: requireEnum(
			record.exposure,
			IMAGE_ORGANIZER_EXPOSURES,
			`${label}.exposure`,
		),
		outfitName: optionalText(record.outfitName, `${label}.outfitName`, 120),
		action: optionalText(
			record.action,
			`${label}.action`,
			MAX_ORGANIZER_ACTION_CHARS,
		),
		negative: optionalText(
			record.negative,
			`${label}.negative`,
			MAX_ORGANIZER_NEGATIVE_CHARS,
		),
		center: assertCenter(record.center, `${label}.center`),
	};
}

function assertOrganizerImage(
	value: unknown,
	label: string,
	paragraphCount: number,
): ImageOrganizerImage {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(
		record,
		[
			"insertAfterParagraph",
			"title",
			"scene",
			"composition",
			"characters",
			"negativePrompt",
		],
		label,
	);
	const insertAfterParagraph = record.insertAfterParagraph;
	if (
		typeof insertAfterParagraph !== "number" ||
		!Number.isInteger(insertAfterParagraph) ||
		insertAfterParagraph < 0 ||
		insertAfterParagraph > paragraphCount
	) {
		throw new Error(
			`${label}.insertAfterParagraph 必须是 0 到 ${paragraphCount} 之间的整数`,
		);
	}
	const composition = record.composition;
	if (typeof composition !== "string") {
		throw new Error(`${label}.composition 必须是字符串`);
	}
	if (composition.trim().length > MAX_ORGANIZER_COMPOSITION_CHARS) {
		throw new Error(
			`${label}.composition 最多 ${MAX_ORGANIZER_COMPOSITION_CHARS} 个字符`,
		);
	}
	if (!Array.isArray(record.characters)) {
		throw new Error(`${label}.characters 必须是数组`);
	}
	if (record.characters.length > MAX_ORGANIZER_CHARACTERS) {
		throw new Error(`${label}.characters 最多 ${MAX_ORGANIZER_CHARACTERS} 个`);
	}
	const characters = record.characters.map((item, index) =>
		assertOrganizerCharacter(item, `${label}.characters[${index}]`),
	);
	const names = new Set<string>();
	for (const [index, character] of characters.entries()) {
		const key = normalizeEntityName(character.name);
		if (names.has(key)) {
			throw new Error(
				`${label}.characters[${index}].name 重复：${character.name}`,
			);
		}
		names.add(key);
	}
	return {
		insertAfterParagraph,
		title: requireText(
			record.title,
			`${label}.title`,
			MAX_ORGANIZER_TITLE_CHARS,
		),
		scene: requireText(
			record.scene,
			`${label}.scene`,
			MAX_ORGANIZER_SCENE_CHARS,
		),
		composition: composition.trim(),
		characters,
		negativePrompt: optionalText(
			record.negativePrompt,
			`${label}.negativePrompt`,
			MAX_ORGANIZER_NEGATIVE_CHARS,
		),
	};
}

function assertExpandedCharacter(
	value: unknown,
	label: string,
): ExpandedOrganizerCharacter {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(
		record,
		["name", "prompt", "negative", "center", "outfitId"],
		label,
	);
	const prompt = record.prompt;
	const negative = record.negative;
	if (typeof prompt !== "string") {
		throw new Error(`${label}.prompt 必须是字符串`);
	}
	if (typeof negative !== "string") {
		throw new Error(`${label}.negative 必须是字符串`);
	}
	const outfitId = record.outfitId;
	if (outfitId !== null && typeof outfitId !== "string") {
		throw new Error(`${label}.outfitId 必须是字符串或 null`);
	}
	return {
		name: requireText(record.name, `${label}.name`, 80),
		prompt,
		negative,
		center: assertCenter(record.center, `${label}.center`),
		outfitId,
	};
}

function assertExpandedImage(
	value: unknown,
	label: string,
): ExpandedOrganizerImage {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(
		record,
		["insertAfterParagraph", "title", "prompt", "negativePrompt", "characters"],
		label,
	);
	const insertAfterParagraph = record.insertAfterParagraph;
	if (
		typeof insertAfterParagraph !== "number" ||
		!Number.isInteger(insertAfterParagraph) ||
		insertAfterParagraph < 0
	) {
		throw new Error(`${label}.insertAfterParagraph 必须是非负整数`);
	}
	const prompt = record.prompt;
	const negativePrompt = record.negativePrompt;
	if (typeof prompt !== "string") {
		throw new Error(`${label}.prompt 必须是字符串`);
	}
	if (typeof negativePrompt !== "string") {
		throw new Error(`${label}.negativePrompt 必须是字符串`);
	}
	if (!Array.isArray(record.characters)) {
		throw new Error(`${label}.characters 必须是数组`);
	}
	return {
		insertAfterParagraph,
		title: requireText(
			record.title,
			`${label}.title`,
			MAX_ORGANIZER_TITLE_CHARS,
		),
		prompt,
		negativePrompt,
		characters: record.characters.map((item, index) =>
			assertExpandedCharacter(item, `${label}.characters[${index}]`),
		),
	};
}

/** 校验存进数据库或从数据库读出的整理结果；未知字段直接拒绝。 */
export function assertImageOrganizerResult(
	value: unknown,
	label = "画面整理结果",
): ImageOrganizerResult {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["images", "expanded"], label);
	if (!Array.isArray(record.images) || record.images.length === 0) {
		throw new Error(`${label}.images 至少需要一项`);
	}
	if (!Array.isArray(record.expanded)) {
		throw new Error(`${label}.expanded 必须是数组`);
	}
	if (record.images.length !== record.expanded.length) {
		throw new Error(`${label}.images 与 expanded 的条数必须相同`);
	}
	const images = record.images.map((item, index) =>
		assertOrganizerImage(item, `${label}.images[${index}]`, 100_000),
	);
	const expanded = record.expanded.map((item, index) =>
		assertExpandedImage(item, `${label}.expanded[${index}]`),
	);
	return { images, expanded };
}

/** 解析模型输出；插入段落必须在目标楼层的段落数以内。 */
export function parseImageOrganizerResponse(
	text: string,
	paragraphCount: number,
	maxImages: number,
): ImageOrganizerImage[] {
	const record = assertPlainObject(
		parseJsonOutputObject(text, "画面整理"),
		"画面整理",
	);
	rejectUnknownKeys(record, ["images"], "画面整理");
	if (!Array.isArray(record.images)) {
		throw new Error("画面整理.images 必须是数组");
	}
	if (record.images.length < 1 || record.images.length > maxImages) {
		throw new Error(
			`画面整理.images 必须有 1 到 ${maxImages} 条，实际为 ${record.images.length} 条`,
		);
	}
	return record.images.map((item, index) =>
		assertOrganizerImage(item, `画面整理.images[${index}]`, paragraphCount),
	);
}

export function splitOrganizerParagraphs(raw: string): string[] {
	const text = raw.replace(/\r\n/g, "\n").trim();
	if (text.length === 0) return [];
	const blocks = text
		.split(/\n\s*\n/)
		.map((block) => block.trim())
		.filter((block) => block.length > 0);
	if (blocks.length > 1) return blocks;
	return text
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export interface ImageOrganizerInput {
	readonly node: TimelineNode;
	readonly previous: TimelineNode | null;
	readonly paragraphs: readonly string[];
	readonly paragraphCount: number;
	readonly presentPages: readonly NotebookPage[];
	readonly worldIndexText: string | null;
	readonly tagGroups: readonly TagLibraryGroup[];
	readonly writingEntries: readonly {
		readonly name: string;
		readonly content: string;
	}[];
	readonly profiles: readonly CharacterVisualProfile[];
	readonly outfits: readonly CharacterOutfit[];
	readonly recentPrompts: readonly string[];
	readonly state: JsonObject;
}

function clip(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function presentNames(store: StoryStore, node: TimelineNode): Set<string> {
	const log =
		store.getSceneLog(node.id) ?? store.getLatestSceneLogOnPath(node.id);
	if (log === null) return new Set();
	return new Set(log.present.map((name) => normalizeEntityName(name)));
}

/** 收集画面整理的全部输入；纯读取，不写库。 */
export function collectImageOrganizerInput(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	config: ImageConfig,
): ImageOrganizerInput {
	const node = store.getNode(nodeId);
	if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
	if (node.storyId !== storyId) {
		throw new Error(`楼层 ${nodeId} 不属于故事 ${storyId}`);
	}
	if (node.role !== "assistant") {
		throw new Error(`画面整理只作用于助手楼层：${nodeId}`);
	}
	const path = store.getPathToNode(nodeId);
	const index = path.findIndex((item) => item.id === nodeId);
	const previous = index > 0 ? (path[index - 1] ?? null) : null;
	const paragraphs = splitOrganizerParagraphs(node.raw);
	const names = presentNames(store, node);
	const pages = readNotebookPages(store, storyId, nodeId).filter((page) =>
		names.has(normalizeEntityName(page.name)),
	);
	const world = renderWorldIndex(store, storyId, nodeId);
	const sourceText = `${previous?.raw ?? ""}\n${node.raw}`;
	const tagGroups = groupTagLibraryEntries(
		matchTagLibraryEntries(store.listTagLibraryEntries(storyId), sourceText),
	);
	const writingEntries = readWritingEntries(store, storyId)
		.filter(
			(entry) =>
				entry.scope === "image_organizer" &&
				entry.enabled &&
				entry.content.trim().length > 0,
		)
		.map((entry) => ({ name: entry.name, content: entry.content }));
	const recentPrompts =
		config.recentPromptHistory === 0
			? []
			: [
					...new Set(
						[...store.listStoryNodeImages(storyId)]
							.filter((image) => image.prompt !== null)
							.sort((left, right) =>
								right.createdAt.localeCompare(left.createdAt),
							)
							.map((image) => image.prompt as string),
					),
				].slice(0, config.recentPromptHistory);
	return {
		node,
		previous,
		paragraphs,
		paragraphCount: paragraphs.length,
		presentPages: pages,
		worldIndexText: world?.text ?? null,
		tagGroups,
		writingEntries,
		profiles: store
			.listCharacterVisualProfiles(storyId)
			.map((record) => record.profile),
		outfits: store.listCharacterOutfits(storyId),
		recentPrompts,
		state: store.getStateSnapshot(nodeId).state,
	};
}

/** 按整理输入拼用户消息；所有来源都标注清楚，模型只负责挑选。 */
export function buildImageOrganizerUserContent(
	input: ImageOrganizerInput,
): string {
	const lines: string[] = [];
	lines.push(
		`目标楼层正文（共 ${input.paragraphCount} 段；insertAfterParagraph 取 0 到 ${input.paragraphCount}，0 表示开头）：`,
	);
	if (input.paragraphs.length === 0) {
		lines.push("（这一楼没有正文）");
	} else {
		input.paragraphs.forEach((paragraph, index) => {
			lines.push(`[${index + 1}] ${clip(paragraph, 4000)}`);
		});
	}
	if (input.previous !== null) {
		lines.push("", "上一楼正文（只作上下文）：");
		lines.push(clip(input.previous.raw, 4000));
	}
	lines.push("", "在场者记事页：");
	if (input.presentPages.length === 0) {
		lines.push("（没有在场者的记事页）");
	} else {
		for (const page of input.presentPages) {
			const now = page.now.trim().length > 0 ? page.now : page.base;
			lines.push(`<记事 name="${page.name}">${clip(now, 800)}</记事>`);
		}
	}
	lines.push("", "世界索引：");
	lines.push(input.worldIndexText ?? "（没有）");
	lines.push("", "按正文命中的标签库条目（只作画法参考，不要照抄整段）：");
	if (input.tagGroups.length === 0) {
		lines.push("（没有命中）");
	} else {
		for (const group of input.tagGroups) {
			lines.push(`分类 ${group.category}：`);
			for (const entry of group.entries) {
				lines.push(
					`<标签 name="${entry.name}">${clip(entry.content, 1200)}</标签>`,
				);
			}
		}
	}
	lines.push("", "画面整理写作条目：");
	if (input.writingEntries.length === 0) {
		lines.push("（没有）");
	} else {
		for (const entry of input.writingEntries) {
			lines.push(
				`<条目 name="${entry.name}">${clip(entry.content, 2000)}</条目>`,
			);
		}
	}
	lines.push("", "已知人物与可选的服装（只写用哪一套，不要写外貌标签）：");
	if (input.profiles.length === 0) {
		lines.push("（还没有视觉档案；人物仍然可以写，但只写动作与可见部位）");
	} else {
		for (const profile of input.profiles) {
			const names = input.outfits
				.filter(
					(outfit) =>
						normalizeEntityName(outfit.character) ===
						normalizeEntityName(profile.character),
				)
				.map((outfit) => outfit.name);
			lines.push(
				`- ${profile.character}：默认 ${profile.defaultOutfit}${names.length === 0 ? "" : `；服装：${names.join("、")}`}`,
			);
		}
	}
	lines.push("", "最近出图提示词（避免重复同一个构图）：");
	if (input.recentPrompts.length === 0) {
		lines.push("（还没有出过图）");
	} else {
		for (const prompt of input.recentPrompts) {
			lines.push(`- ${clip(prompt, 800)}`);
		}
	}
	return lines.join("\n");
}

function buildSystemPrompt(maxImages: number, paragraphCount: number): string {
	return [
		`你是画面整理师。读完输入，为这一楼挑选 1 到 ${maxImages} 个值得画的画面，输出严格 JSON。`,
		`- insertAfterParagraph：整数 0 到 ${paragraphCount}，表示插图放在第几段之后，0 表示这一离开头。`,
		"- title：短标题，不超过 20 个字。",
		"- scene：这个画面发生了什么，一到两句；写动作、气氛、地点，不写名字以外的设定。",
		`- composition：构图、镜头与气氛标签，不超过 ${MAX_ORGANIZER_COMPOSITION_CHARS} 个字符；没有就写空字符串。`,
		"- characters：最多 4 个。每个人只写：name（用输入里的人物名）、angle（front 或 back）、body（face 只看脸、upper 上半身、full 全身）、exposure（clothed 着装、bare 裸露、hidden 这个部位不在画面里）、outfitName（可选，从这个人物的服装里选一套；不确定就写 null）、action（可选的动作短语）、negative（可选，人物级负面）、center（可选，坐标 {x,y}，取值 0 到 1）。",
		"- 不要写发型、瞳色、体型这类固定外貌；外貌由程序按视觉档案展开。",
		"- negativePrompt：可选，整张图额外的负面标签。",
		"- 人物必须是输入里出现过的名字；不要在两个人之间分配同一套服装。",
		"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记。形如：",
		`{"images":[{"insertAfterParagraph":1,"title":"…","scene":"…","composition":"…","characters":[{"name":"…","angle":"front","body":"upper","exposure":"clothed","outfitName":"…","action":"…","negative":"…","center":{"x":0.5,"y":0.5}}],"negativePrompt":"…"}]}`,
	].join("\n");
}

function findProfile(
	profiles: readonly CharacterVisualProfile[],
	name: string,
): CharacterVisualProfile | null {
	const key = normalizeEntityName(name);
	return (
		profiles.find(
			(profile) => normalizeEntityName(profile.character) === key,
		) ?? null
	);
}

export interface ExpandOrganizerResultInput {
	readonly images: readonly ImageOrganizerImage[];
	readonly profiles: readonly CharacterVisualProfile[];
	readonly outfits: readonly CharacterOutfit[];
	readonly state: JsonObject;
	readonly rules: readonly ImageReplacementRule[];
}

/** 把结构化人物选择展开成最终提示词；外貌与服装由程序补齐。 */
export function expandImageOrganizerResult(
	input: ExpandOrganizerResultInput,
): ImageOrganizerResult {
	const expanded = input.images.map((image) => {
		const positiveRaw: string[] = [image.scene, image.composition];
		const negativeRaw: string[] = [];
		const characters = image.characters.map((character) => {
			const profile = findProfile(input.profiles, character.name);
			const outfit =
				profile === null
					? null
					: selectCharacterOutfit(input.outfits, profile.character, {
							selected: character.outfitName,
							profile,
							state: input.state,
						});
			const appearance =
				profile === null
					? [character.name]
					: expandVisualProfile({
							profile,
							outfit,
							view: character.angle,
							visiblePart: character.body,
							state: character.exposure,
						}).tags;
			const action = character.action === null ? [] : [character.action];
			const rawTags = [...appearance, ...action];
			const negative = [
				...(profile?.negative ?? []),
				...(character.negative === null ? [] : [character.negative]),
			];
			positiveRaw.push(...rawTags);
			negativeRaw.push(...negative);
			return {
				name: character.name,
				prompt: finalizeImageTags(rawTags, input.rules).join(", "),
				negative: finalizeImageTags(negative, input.rules).join(", "),
				center: character.center,
				outfitId: outfit?.id ?? null,
			};
		});
		const prompt = finalizeImagePrompt(positiveRaw, input.rules);
		const negativePrompt = finalizeImagePrompt(
			[
				...DEFAULT_IMAGE_NEGATIVE_TAGS,
				...negativeRaw,
				image.negativePrompt ?? "",
			],
			input.rules,
		);
		return {
			insertAfterParagraph: image.insertAfterParagraph,
			title: image.title,
			prompt,
			negativePrompt,
			characters,
		};
	});
	return { images: input.images, expanded };
}

function readOrganizeRequests(store: StoryStore, storyId: string): string[] {
	const value = store.getStoryValue(storyId, ORGANIZE_REQUEST_KEY);
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function writeOrganizeRequests(
	store: StoryStore,
	storyId: string,
	requests: readonly string[],
): void {
	store.setStoryValue(
		storyId,
		ORGANIZE_REQUEST_KEY,
		requests.length === 0 ? null : [...requests],
	);
}

function onPathNode(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): TimelineNode | null {
	const node = store.getNode(nodeId);
	if (node === null || node.storyId !== storyId) return null;
	if (node.role !== "assistant") return null;
	if (!store.getPathToHead(storyId).some((item) => item.id === nodeId)) {
		return null;
	}
	return node;
}

function takeManualTarget(
	store: StoryStore,
	storyId: string,
): { readonly node: TimelineNode; readonly remaining: string[] } | null {
	const requests = readOrganizeRequests(store, storyId);
	const valid: string[] = [];
	let target: TimelineNode | null = null;
	for (const nodeId of requests) {
		const node = onPathNode(store, storyId, nodeId);
		if (node === null) continue;
		if (target === null) {
			target = node;
			continue;
		}
		valid.push(nodeId);
	}
	if (target === null) {
		if (requests.length !== valid.length) {
			writeOrganizeRequests(store, storyId, valid);
		}
		return null;
	}
	return { node: target, remaining: valid };
}

function isSettledAssistant(store: StoryStore, node: TimelineNode): boolean {
	if (node.role !== "assistant") return false;
	const trace = store.getTurnTrace(node.id);
	if (trace === null) return true;
	return trace.profile !== "naive" && trace.llm.stopReason !== "aborted";
}

function assistantFloorsSinceLastImage(
	store: StoryStore,
	storyId: string,
	path: readonly TimelineNode[],
	candidateIndex: number,
): number {
	const imageNodeIds = new Set(store.listNodeImageNodeIds(storyId));
	let lastImageIndex = -1;
	for (let index = candidateIndex; index >= 0; index -= 1) {
		if (imageNodeIds.has(path[index]?.id as string)) {
			lastImageIndex = index;
			break;
		}
	}
	if (lastImageIndex === -1) return Number.POSITIVE_INFINITY;
	let count = 0;
	for (let index = lastImageIndex + 1; index < candidateIndex; index += 1) {
		if (path[index]?.role === "assistant") count += 1;
	}
	return count;
}

function automaticTarget(
	store: StoryStore,
	storyId: string,
	config: ImageConfig,
): TimelineNode | null {
	const trigger: ImageTrigger =
		config.mode === "manual" ? "manual" : config.trigger;
	if (config.mode !== "auto" || trigger === "manual") return null;
	const path = store.getPathToHead(storyId);
	const organized = new Set(
		store
			.listStoryNodeImages(storyId)
			.filter((image) => image.organizerResult !== null)
			.map((image) => image.nodeId),
	);
	// 从最新楼层往回找：当前场景的插图优先，旧楼层轮到下一轮。
	for (const [index, node] of [...path.entries()].reverse()) {
		if (node.role !== "assistant") continue;
		if (!isSettledAssistant(store, node)) continue;
		if (
			trigger === "scene_end" &&
			store.getSceneLog(node.id)?.sceneEnds !== true
		) {
			continue;
		}
		if (organized.has(node.id)) continue;
		if (store.countNodeImages(node.id) >= config.maxPerFloor) continue;
		if (
			assistantFloorsSinceLastImage(store, storyId, path, index) <
			config.minFloorsBetween
		) {
			continue;
		}
		return node;
	}
	return null;
}

function workflowReady(store: StoryStore, config: ImageConfig): boolean {
	const workflowId = config.workflowId.trim();
	if (workflowId.length === 0) return false;
	return store.getImageWorkflow(workflowId) !== null;
}

/** 自动触发是否还有没整理过的楼层；手动请求也算需要运行。 */
export function imageOrganizerNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const config = store.getStorySettings(storyId).imageConfig;
	if (config.mode === "off" || !workflowReady(store, config)) return false;
	if (takeManualPreview(store, storyId)) return true;
	return automaticTarget(store, storyId, config) !== null;
}

function takeManualPreview(store: StoryStore, storyId: string): boolean {
	return readOrganizeRequests(store, storyId).some(
		(nodeId) => onPathNode(store, storyId, nodeId) !== null,
	);
}

export interface ImageOrganizerHandlerOptions {
	/** 覆盖客户端默认模型；不设置时使用后台客户端。 */
	readonly model?: string;
	/** 测试注入固定 seed；不提供时随机生成。 */
	readonly seed?: () => number;
}

interface OrganizeFloorResult {
	readonly inserted: number;
}

function organizeFloor(
	store: StoryStore,
	storyId: string,
	node: TimelineNode,
	config: ImageConfig,
	client: LlmClient,
	options: ImageOrganizerHandlerOptions,
	signal: AbortSignal | undefined,
): Promise<OrganizeFloorResult> {
	return (async () => {
		const input = collectImageOrganizerInput(store, storyId, node.id, config);
		const messages: LlmMessage[] = [
			{
				role: "system",
				content: buildSystemPrompt(config.maxPerFloor, input.paragraphCount),
			},
			{ role: "user", content: buildImageOrganizerUserContent(input) },
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
		const images = parseImageOrganizerResponse(
			result.text,
			input.paragraphCount,
			config.maxPerFloor,
		);
		const organizerResult = expandImageOrganizerResult({
			images,
			profiles: input.profiles,
			outfits: input.outfits,
			state: input.state,
			rules: config.replacementRules,
		});
		const remaining = Math.max(
			0,
			config.maxPerFloor - store.countNodeImages(node.id),
		);
		const limit = Math.min(remaining, organizerResult.expanded.length);
		const seed =
			options.seed ?? (() => Math.floor(Math.random() * 2_147_483_648));
		for (let index = 0; index < limit; index += 1) {
			const expanded = organizerResult.expanded[
				index
			] as ExpandedOrganizerImage;
			const image = organizerResult.images[index] as ImageOrganizerImage;
			const request: ImagePromptRequest = {
				...(image.characters.length === 0
					? {}
					: { characters: image.characters.map((item) => item.name) }),
				scene: image.scene,
			};
			store.insertNodeImage({
				storyId,
				nodeId: node.id,
				request,
				workflowId: config.workflowId.trim(),
				seed: seed(),
				prompt: expanded.prompt,
				negativePrompt: expanded.negativePrompt,
				insertAfterParagraph: expanded.insertAfterParagraph,
				title: expanded.title,
				organizerResult,
			});
		}
		return { inserted: limit };
	})();
}

/** 后台岗位「画面整理」：一次调用整理一楼，成功后再排 illustrate。 */
export function createImageOrganizerHandler(
	options: ImageOrganizerHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const config = store.getStorySettings(job.storyId).imageConfig;
		if (config.mode === "off" || !workflowReady(store, config)) return;
		const manual = takeManualTarget(store, job.storyId);
		const node =
			manual?.node ?? automaticTarget(store, job.storyId, config) ?? null;
		if (node === null) return;
		await organizeFloor(
			store,
			job.storyId,
			node,
			config,
			client,
			options,
			signal,
		);
		if (manual !== null) {
			writeOrganizeRequests(store, job.storyId, manual.remaining);
		}
		enqueueIllustrateBackgroundJob(store, job.storyId);
	};
}

/** 玩家手动点「画这一幕」：记录请求并入队故事级整理任务。 */
export function requestImageOrganization(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): BackgroundJob {
	const node = store.getNode(nodeId);
	if (node === null) throw new Error(`楼层节点不存在：${nodeId}`);
	if (node.storyId !== storyId) {
		throw new Error(`楼层 ${nodeId} 不属于故事 ${storyId}`);
	}
	if (node.role !== "assistant") {
		throw new Error(`画面整理只作用于助手楼层：${nodeId}`);
	}
	if (onPathNode(store, storyId, nodeId) === null) {
		throw new Error(`楼层 ${nodeId} 不在当前路径上，不能整理插图`);
	}
	const config = store.getStorySettings(storyId).imageConfig;
	if (config.mode === "off") throw new Error("生图模式已关闭");
	if (!workflowReady(store, config)) {
		throw new Error("故事没有选择可用的生图 workflow");
	}
	const requests = readOrganizeRequests(store, storyId);
	const next = requests.includes(nodeId) ? requests : [...requests, nodeId];
	writeOrganizeRequests(store, storyId, next);
	const [job] = store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [IMAGE_ORGANIZER_JOB_KIND],
	});
	if (job === undefined) {
		throw new Error(`故事 ${storyId} 的画面整理任务没有入队`);
	}
	return job;
}

/** 自动整理需要时确保故事级任务存在；不需要时返回空数组。 */
export function enqueueImageOrganizerBackgroundJob(
	store: StoryStore,
	storyId: string,
): BackgroundJob[] {
	if (!imageOrganizerNeedsRun(store, storyId)) return [];
	return store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [IMAGE_ORGANIZER_JOB_KIND],
	});
}
