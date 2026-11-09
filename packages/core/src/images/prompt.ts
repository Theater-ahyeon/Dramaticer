import type { JsonObject } from "../json.js";
import { readStateValue } from "../state.js";
import type { CharacterVisualProfile } from "./types.js";

export const IMAGE_SHOTS = ["close-up", "medium", "wide", "scenery"] as const;

export type ImageShot = (typeof IMAGE_SHOTS)[number];

export function isImageShot(value: unknown): value is ImageShot {
	return (
		typeof value === "string" &&
		(IMAGE_SHOTS as readonly string[]).includes(value)
	);
}

export type ImagePromptStyle = "tags" | "natural";

export function isImagePromptStyle(value: unknown): value is ImagePromptStyle {
	return value === "tags" || value === "natural";
}

/** 所有后端共用的负向标签；角色自己的负向标签会合并进去。 */
export const DEFAULT_IMAGE_NEGATIVE_TAGS = [
	"lowres",
	"bad anatomy",
	"extra fingers",
	"watermark",
	"text",
] as const;

export const DEFAULT_IMAGE_NEGATIVE_PROMPT = DEFAULT_IMAGE_NEGATIVE_TAGS.join(
	", ",
);

export const MAX_IMAGE_PROMPT_CHARACTERS = 4;

/** `illustrate` 工具的参数；提示词编译与工具校验共用这个形状。 */
export interface ImagePromptRequest {
	readonly characters?: readonly string[];
	readonly scene: string;
	readonly shot?: ImageShot;
	readonly mood?: string;
}

export interface CompileImagePromptInput {
	readonly profiles: readonly CharacterVisualProfile[];
	/** 楼层末端的台账快照；用来读取 `outfitPath` 指向的当前服装。 */
	readonly state: JsonObject;
	readonly request: ImagePromptRequest;
	readonly style: ImagePromptStyle;
}

export interface CompiledImagePrompt {
	readonly prompt: string;
	readonly negativePrompt: string;
	/** 请求里没有视觉档案的人物，按原顺序列出。 */
	readonly missingProfiles: readonly string[];
}

const SHOT_LABELS: Readonly<Record<ImageShot, string>> = {
	"close-up": "特写",
	medium: "中景",
	wide: "远景",
	scenery: "风景",
};

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function normalizeRequest(request: ImagePromptRequest): {
	readonly characters: readonly string[];
	readonly scene: string;
	readonly shot: ImageShot | null;
	readonly mood: string | null;
} {
	const scene = requireText(request.scene, "生图请求的 scene");
	const characters: string[] = [];
	const seen = new Set<string>();
	if (request.characters !== undefined) {
		if (!Array.isArray(request.characters)) {
			throw new Error("生图请求的 characters 必须是字符串数组");
		}
		if (request.characters.length > MAX_IMAGE_PROMPT_CHARACTERS) {
			throw new Error(
				`生图请求的 characters 最多 ${MAX_IMAGE_PROMPT_CHARACTERS} 个`,
			);
		}
		for (const [index, item] of request.characters.entries()) {
			const name = requireText(item, `生图请求的 characters[${index}]`);
			if (seen.has(name)) continue;
			seen.add(name);
			characters.push(name);
		}
	}
	let shot: ImageShot | null = null;
	if (request.shot !== undefined) {
		if (!isImageShot(request.shot)) {
			throw new Error(
				`生图请求的 shot 必须是 ${IMAGE_SHOTS.join("、")} 之一`,
			);
		}
		shot = request.shot;
	}
	const mood =
		request.mood === undefined
			? null
			: requireText(request.mood, "生图请求的 mood");
	return { characters, scene, shot, mood };
}

function findProfile(
	profiles: readonly CharacterVisualProfile[],
	character: string,
): CharacterVisualProfile | null {
	return profiles.find((profile) => profile.character === character) ?? null;
}

/** 当前服装优先取台账里的值，读不到时用档案的默认服装。 */
function resolveOutfit(
	profile: CharacterVisualProfile,
	state: JsonObject,
): string {
	if (profile.outfitPath !== null) {
		const value = readStateValue(state, profile.outfitPath);
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return profile.defaultOutfit;
}

function compileTags(
	input: CompileImagePromptInput,
	request: ReturnType<typeof normalizeRequest>,
): CompiledImagePrompt {
	const tags: string[] = [];
	const seen = new Set<string>();
	const addTag = (value: string): void => {
		const tag = value.trim();
		if (tag.length === 0 || seen.has(tag)) return;
		seen.add(tag);
		tags.push(tag);
	};
	const negativeTags: string[] = [];
	const seenNegative = new Set<string>();
	const addNegative = (value: string): void => {
		const tag = value.trim();
		if (tag.length === 0 || seenNegative.has(tag)) return;
		seenNegative.add(tag);
		negativeTags.push(tag);
	};
	const missingProfiles: string[] = [];
	for (const character of request.characters) {
		const profile = findProfile(input.profiles, character);
		if (profile === null) {
			missingProfiles.push(character);
			addTag(character);
			continue;
		}
		for (const tag of profile.base) addTag(tag);
		addTag(resolveOutfit(profile, input.state));
		for (const tag of profile.negative) addNegative(tag);
	}
	addTag(request.scene);
	if (request.shot !== null) addTag(request.shot);
	if (request.mood !== null) addTag(request.mood);
	for (const tag of DEFAULT_IMAGE_NEGATIVE_TAGS) addNegative(tag);
	return {
		prompt: tags.join(", "),
		negativePrompt: negativeTags.join(", "),
		missingProfiles,
	};
}

function compileNatural(
	input: CompileImagePromptInput,
	request: ReturnType<typeof normalizeRequest>,
): CompiledImagePrompt {
	const missingProfiles: string[] = [];
	const descriptions: string[] = [];
	for (const character of request.characters) {
		const profile = findProfile(input.profiles, character);
		if (profile === null) {
			missingProfiles.push(character);
			descriptions.push(character);
			continue;
		}
		const traits = [...profile.base, resolveOutfit(profile, input.state)];
		descriptions.push(`${character}（${traits.join("，")}）`);
	}
	const sentences: string[] = [request.scene];
	if (descriptions.length > 0) {
		sentences.push(`人物：${descriptions.join("；")}`);
	}
	if (request.shot !== null) {
		sentences.push(`镜头：${SHOT_LABELS[request.shot]}`);
	}
	if (request.mood !== null) sentences.push(`气氛：${request.mood}`);
	const negativeTags: string[] = [];
	const seenNegative = new Set<string>();
	const addNegative = (value: string): void => {
		const tag = value.trim();
		if (tag.length === 0 || seenNegative.has(tag)) return;
		seenNegative.add(tag);
		negativeTags.push(tag);
	};
	for (const character of request.characters) {
		const profile = findProfile(input.profiles, character);
		if (profile === null) continue;
		for (const tag of profile.negative) addNegative(tag);
	}
	for (const tag of DEFAULT_IMAGE_NEGATIVE_TAGS) addNegative(tag);
	return {
		prompt: `${sentences.join("。")}。`,
		negativePrompt: negativeTags.join(", "),
		missingProfiles,
	};
}

/**
 * 把视觉档案与台账状态编译成生图提示词。纯函数：不读数据库、不调用模型，
 * 同一输入逐字节相同。没有档案的人物仍然进入提示词，只是被列进
 * `missingProfiles`。
 */
export function compileImagePrompt(
	input: CompileImagePromptInput,
): CompiledImagePrompt {
	if (!isImagePromptStyle(input.style)) {
		throw new Error("生图提示词风格必须是 tags 或 natural");
	}
	const request = normalizeRequest(input.request);
	return input.style === "tags"
		? compileTags(input, request)
		: compileNatural(input, request);
}
