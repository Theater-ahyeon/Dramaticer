import { normalizeEntityName } from "../entity.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { ComfyUiSlots, ComfyUiWorkflow } from "./slots.js";

/** 保存在数据库里的 workflow 模板；`payload` 是原始 API 格式 JSON。 */
export interface ImageWorkflowRecord {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly payload: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface SaveImageWorkflowInput {
	readonly name: string;
	readonly provider: string;
	readonly payload: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
}

/**
 * 角色视觉档案：生图提示词的基础素材。`backends` 留给各图像后端自己的
 * 额外配置，第一批固定为空对象。
 */
export interface CharacterVisualProfile {
	readonly character: string;
	/** 基础外貌标签，按稳定特征排列。 */
	readonly base: readonly string[];
	readonly defaultOutfit: string;
	/** 台账里当前服装的路径；为空表示始终使用 defaultOutfit。 */
	readonly outfitPath: readonly string[] | null;
	readonly negative: readonly string[];
	/** 固定 seed；为空时由出图任务自行生成。 */
	readonly seed: number | null;
	readonly backends: Readonly<Record<string, never>>;
}

export const VISUAL_PROFILE_SOURCES = ["model", "player", "import"] as const;

export type VisualProfileSource = (typeof VISUAL_PROFILE_SOURCES)[number];

export function isVisualProfileSource(
	value: unknown,
): value is VisualProfileSource {
	return (
		typeof value === "string" &&
		(VISUAL_PROFILE_SOURCES as readonly string[]).includes(value)
	);
}

const PROFILE_FIELDS = [
	"character",
	"base",
	"defaultOutfit",
	"outfitPath",
	"negative",
	"seed",
	"backends",
] as const;

const MAX_PROFILE_SEED = Number.MAX_SAFE_INTEGER;

function requireProfileText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}

function requireTagList(
	value: unknown,
	label: string,
	allowEmpty: boolean,
): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是字符串数组`);
	}
	if (!allowEmpty && value.length === 0) {
		throw new Error(`${label} 至少需要一项`);
	}
	return value.map((item, index) =>
		requireProfileText(item, `${label}[${index}]`),
	);
}

function requireOutfitPath(value: unknown, label: string): string[] | null {
	if (value === null) return null;
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是非空路径数组或 null`);
	}
	return value.map((item, index) =>
		requireProfileText(item, `${label}[${index}]`),
	);
}

function requireSeed(value: unknown, label: string): number | null {
	if (value === null) return null;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > MAX_PROFILE_SEED
	) {
		throw new Error(
			`${label} 必须是 0 到 ${MAX_PROFILE_SEED} 之间的整数或 null`,
		);
	}
	return value;
}

function requireEmptyBackends(
	value: unknown,
	label: string,
): Record<string, never> {
	const object = assertPlainObject(value, label);
	rejectUnknownKeys(object, [], label);
	return {};
}

/** 校验视觉档案的字段形状；人物是否已知由调用方判断。 */
export function assertCharacterVisualProfile(
	value: unknown,
	label = "视觉档案",
): CharacterVisualProfile {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, PROFILE_FIELDS, label);
	const character = requireProfileText(record.character, `${label}.character`);
	const base = requireTagList(record.base, `${label}.base`, false);
	const defaultOutfit = requireProfileText(
		record.defaultOutfit,
		`${label}.defaultOutfit`,
	);
	const outfitPath =
		record.outfitPath === undefined
			? null
			: requireOutfitPath(record.outfitPath, `${label}.outfitPath`);
	const negative =
		record.negative === undefined
			? []
			: requireTagList(record.negative, `${label}.negative`, true);
	const seed =
		record.seed === undefined
			? null
			: requireSeed(record.seed, `${label}.seed`);
	const backends =
		record.backends === undefined
			? {}
			: requireEmptyBackends(record.backends, `${label}.backends`);
	return {
		character,
		base,
		defaultOutfit,
		outfitPath,
		negative,
		seed,
		backends,
	};
}

/** 同一批档案里的人物不能重复；比较时忽略大小写与标点。 */
export function assertUniqueVisualProfiles(
	profiles: readonly CharacterVisualProfile[],
	label = "视觉档案",
): void {
	const seen = new Map<string, number>();
	profiles.forEach((profile, index) => {
		const key = normalizeEntityName(profile.character);
		const first = seen.get(key);
		if (first !== undefined) {
			throw new Error(
				`${label}[${index}].character 与第 ${first} 条重复：${profile.character}`,
			);
		}
		seen.set(key, index);
	});
}

/** 保存在数据库里的视觉档案；同一故事里的同一人物只有一行。 */
export interface CharacterVisualProfileRecord {
	readonly storyId: string;
	readonly character: string;
	readonly profile: CharacterVisualProfile;
	readonly source: VisualProfileSource;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface SaveCharacterVisualProfilesInput {
	readonly storyId: string;
	readonly profiles: readonly CharacterVisualProfile[];
	readonly source: VisualProfileSource;
	readonly createdAt?: string;
	readonly updatedAt?: string;
}

/** 删除仍被图片记录引用的 workflow。 */
export class ImageWorkflowInUseError extends Error {
	readonly workflowId: string;
	readonly imageCount: number;

	constructor(workflowId: string, imageCount: number) {
		super(
			`图片 workflow ${workflowId} 仍被 ${imageCount} 条图片记录引用，不能删除`,
		);
		this.name = "ImageWorkflowInUseError";
		this.workflowId = workflowId;
		this.imageCount = imageCount;
	}
}
