import { normalizeEntityName } from "../entity.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { NovelAiParameters } from "./novelai-params.js";
import type { ImagePromptRequest } from "./prompt.js";
import type { ComfyUiSlots, ComfyUiWorkflow } from "./slots.js";
import {
	VISUAL_DRESS_STATES,
	VISUAL_SLOT_PARTS,
	VISUAL_SLOT_VIEWS,
	type VisualSlotGrid,
	emptyVisualSlotGrid,
} from "./vocabulary.js";

export const IMAGE_MODES = ["off", "manual", "auto"] as const;

export type ImageMode = (typeof IMAGE_MODES)[number];

export function isImageMode(value: unknown): value is ImageMode {
	return (
		typeof value === "string" &&
		(IMAGE_MODES as readonly string[]).includes(value)
	);
}

/** 故事的出图配置；`mode` 只有 auto 会把 illustrate 工具发给模型。 */
export interface ImageConfig {
	readonly mode: ImageMode;
	/** 为空表示没有选择 workflow；手动与自动模式都需要它。 */
	readonly workflowId: string;
	/** 每楼最多接受几张图。 */
	readonly maxPerFloor: number;
	/** 两次出图之间至少隔多少个助手楼层。 */
	readonly minFloorsBetween: number;
}

export const MIN_IMAGES_PER_FLOOR = 1;
export const MAX_IMAGES_PER_FLOOR = 4;
export const MIN_IMAGE_FLOOR_GAP = 0;
export const MAX_IMAGE_FLOOR_GAP = 100;

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
	mode: "off",
	workflowId: "",
	maxPerFloor: 1,
	minFloorsBetween: 3,
};

const IMAGE_CONFIG_KEYS = [
	"mode",
	"workflowId",
	"maxPerFloor",
	"minFloorsBetween",
] as const;

/** 校验故事设置里的出图配置；范围与工具注册、频率检查共用。 */
export function assertImageConfig(
	value: unknown,
	label = "故事设置的 imageConfig",
): ImageConfig {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, IMAGE_CONFIG_KEYS, label);
	if (!isImageMode(record.mode)) {
		throw new Error(`${label}.mode 必须是 off、manual 或 auto`);
	}
	if (typeof record.workflowId !== "string") {
		throw new Error(`${label}.workflowId 必须是字符串`);
	}
	const maxPerFloor = record.maxPerFloor;
	if (
		typeof maxPerFloor !== "number" ||
		!Number.isInteger(maxPerFloor) ||
		maxPerFloor < MIN_IMAGES_PER_FLOOR ||
		maxPerFloor > MAX_IMAGES_PER_FLOOR
	) {
		throw new Error(
			`${label}.maxPerFloor 必须是 ${MIN_IMAGES_PER_FLOOR} 到 ${MAX_IMAGES_PER_FLOOR} 之间的整数`,
		);
	}
	const minFloorsBetween = record.minFloorsBetween;
	if (
		typeof minFloorsBetween !== "number" ||
		!Number.isInteger(minFloorsBetween) ||
		minFloorsBetween < MIN_IMAGE_FLOOR_GAP ||
		minFloorsBetween > MAX_IMAGE_FLOOR_GAP
	) {
		throw new Error(
			`${label}.minFloorsBetween 必须是 ${MIN_IMAGE_FLOOR_GAP} 到 ${MAX_IMAGE_FLOOR_GAP} 之间的整数`,
		);
	}
	return {
		mode: record.mode,
		workflowId: record.workflowId.trim(),
		maxPerFloor,
		minFloorsBetween,
	};
}

export const NODE_IMAGE_STATUSES = [
	"pending",
	"running",
	"done",
	"failed",
] as const;

export type NodeImageStatus = (typeof NODE_IMAGE_STATUSES)[number];

export function isNodeImageStatus(value: unknown): value is NodeImageStatus {
	return (
		typeof value === "string" &&
		(NODE_IMAGE_STATUSES as readonly string[]).includes(value)
	);
}

/** 楼层上的一条出图记录；图片是楼层的附属数据，不是原文的一部分。 */
export interface NodeImageRecord {
	readonly id: string;
	readonly storyId: string;
	readonly nodeId: string;
	readonly ordinal: number;
	readonly status: NodeImageStatus;
	/** 模型或玩家的原始生图请求。 */
	readonly request: ImagePromptRequest;
	readonly prompt: string | null;
	readonly negativePrompt: string | null;
	readonly workflowId: string;
	readonly seed: number | null;
	readonly attempts: number;
	readonly fileName: string | null;
	readonly mediaType: string | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly error: string | null;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface NewNodeImageInput {
	readonly storyId: string;
	readonly nodeId: string;
	readonly request: ImagePromptRequest;
	readonly workflowId: string;
	readonly seed: number | null;
	readonly createdAt?: string;
}

export const IMAGE_WORKFLOW_KINDS = ["comfyui", "novelai"] as const;

export type ImageWorkflowKind = (typeof IMAGE_WORKFLOW_KINDS)[number];

interface ImageWorkflowBase {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

/** ComfyUI 的 workflow 模板；`payload` 是原始 API 格式 JSON。 */
export interface ComfyUiWorkflowRecord extends ImageWorkflowBase {
	readonly kind: "comfyui";
	readonly payload: ComfyUiWorkflow;
	readonly slots: ComfyUiSlots;
}

/** NovelAI 的出图模板：模型、尺寸、采样等参数；提示词由出图任务填入。 */
export interface NovelAiWorkflowRecord extends ImageWorkflowBase {
	readonly kind: "novelai";
	readonly payload: NovelAiParameters;
	readonly slots: null;
}

/** 保存在数据库里的出图模板，按 `kind` 区分后端。 */
export type ImageWorkflowRecord = ComfyUiWorkflowRecord | NovelAiWorkflowRecord;

export type SaveImageWorkflowInput =
	| {
			readonly kind?: "comfyui";
			readonly name: string;
			readonly provider: string;
			readonly payload: ComfyUiWorkflow;
			readonly slots: ComfyUiSlots;
	  }
	| {
			readonly kind: "novelai";
			readonly name: string;
			readonly provider: string;
			readonly payload: NovelAiParameters;
	  };

/**
 * 角色视觉档案：生图提示词的基础素材。`backends` 留给各图像后端自己的
 * 额外配置，第一批固定为空对象。
 */
export interface CharacterVisualProfile {
	readonly character: string;
	/** 基础外貌标签，按稳定特征排列；分格为空时用它。 */
	readonly base: readonly string[];
	readonly defaultOutfit: string;
	/** 台账里当前服装的路径；为空表示始终使用 defaultOutfit。 */
	readonly outfitPath: readonly string[] | null;
	readonly negative: readonly string[];
	/** 固定 seed；为空时由出图任务自行生成。 */
	readonly seed: number | null;
	readonly backends: Readonly<Record<string, never>>;
	/** 锁定后后台自动生成不会覆盖这个人物。 */
	readonly locked: boolean;
	readonly slots: VisualSlotGrid;
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
	"locked",
	"slots",
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

function requireSlotGrid(value: unknown, label: string): VisualSlotGrid {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, VISUAL_SLOT_PARTS, label);
	const grid = emptyVisualSlotGrid();
	const mutable: Record<string, unknown> = {};
	for (const part of VISUAL_SLOT_PARTS) {
		const rawPart = record[part];
		if (rawPart === undefined) {
			mutable[part] = grid[part];
			continue;
		}
		const partLabel = `${label}.${part}`;
		const partRecord = assertPlainObject(rawPart, partLabel);
		rejectUnknownKeys(partRecord, VISUAL_SLOT_VIEWS, partLabel);
		const partViews: Record<string, unknown> = {};
		for (const view of VISUAL_SLOT_VIEWS) {
			const rawView = partRecord[view];
			if (rawView === undefined) {
				partViews[view] = grid[part][view];
				continue;
			}
			const viewLabel = `${partLabel}.${view}`;
			const viewRecord = assertPlainObject(rawView, viewLabel);
			rejectUnknownKeys(viewRecord, VISUAL_DRESS_STATES, viewLabel);
			const states: Record<string, unknown> = {};
			for (const state of VISUAL_DRESS_STATES) {
				const rawState = viewRecord[state];
				states[state] =
					rawState === undefined
						? []
						: requireTagList(rawState, `${viewLabel}.${state}`, true);
			}
			partViews[view] = states;
		}
		mutable[part] = partViews;
	}
	return mutable as VisualSlotGrid;
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
	const locked = record.locked ?? false;
	if (typeof locked !== "boolean") {
		throw new Error(`${label}.locked 必须是布尔值`);
	}
	const slots =
		record.slots === undefined
			? emptyVisualSlotGrid()
			: requireSlotGrid(record.slots, `${label}.slots`);
	return {
		character,
		base,
		defaultOutfit,
		outfitPath,
		negative,
		seed,
		backends,
		locked,
		slots,
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
