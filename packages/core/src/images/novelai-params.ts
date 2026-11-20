import { assertPlainObject, rejectUnknownKeys } from "../json.js";

/**
 * NovelAI 出图模板的参数。字段名用本项目自己的写法，请求时再换成 NovelAI 的字段；
 * 提示词、负面提示词与 seed 由出图任务按楼层填入，不放在模板里。
 */
export interface NovelAiParameters {
	readonly model: string;
	readonly width: number;
	readonly height: number;
	readonly steps: number;
	/** 提示词引导强度（NovelAI 的 scale）。 */
	readonly scale: number;
	readonly sampler: string;
	readonly noiseSchedule: string;
	readonly sm: boolean;
	readonly smDyn: boolean;
	/** 打开后按尺寸与模型算 `skip_cfg_above_sigma`，画面更多变。 */
	readonly varietyBoost: boolean;
	/** 追加在提示词末尾的画质标签。 */
	readonly qualityTags: string;
	/** 放在负面提示词最前面的固定标签。 */
	readonly negativeTags: string;
}

export const DEFAULT_NOVELAI_PARAMETERS: NovelAiParameters = {
	model: "nai-diffusion-4-5-full",
	width: 832,
	height: 1216,
	steps: 28,
	scale: 5,
	sampler: "k_euler_ancestral",
	noiseSchedule: "karras",
	sm: false,
	smDyn: false,
	varietyBoost: false,
	qualityTags: "best quality, amazing quality, very aesthetic, absurdres",
	negativeTags:
		"lowres, bad anatomy, bad hands, text, error, worst quality, jpeg artifacts, watermark, signature",
};

const KEYS = Object.keys(
	DEFAULT_NOVELAI_PARAMETERS,
) as (keyof NovelAiParameters)[];

export const NOVELAI_MIN_SIZE = 64;
export const NOVELAI_MAX_SIZE = 2048;
export const NOVELAI_MAX_STEPS = 50;
export const NOVELAI_MAX_SCALE = 10;

function intIn(
	value: unknown,
	label: string,
	min: number,
	max: number,
	step = 1,
): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < min ||
		value > max ||
		value % step !== 0
	) {
		throw new Error(
			`${label} 必须是 ${min} 到 ${max} 之间的整数${step > 1 ? `，且是 ${step} 的倍数` : ""}`,
		);
	}
	return value;
}

function text(value: unknown, label: string, allowEmpty: boolean): string {
	if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
		throw new Error(`${label} 必须是${allowEmpty ? "" : "非空"}字符串`);
	}
	return value.trim();
}

function bool(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
	return value;
}

/** 校验并补全 NovelAI 参数；缺省字段取默认值。 */
export function assertNovelAiParameters(
	value: unknown,
	label = "NovelAI 参数",
): NovelAiParameters {
	const record = assertPlainObject(value ?? {}, label);
	rejectUnknownKeys(record, KEYS, label);
	const merged = { ...DEFAULT_NOVELAI_PARAMETERS, ...record } as Record<
		string,
		unknown
	>;
	const scale = merged.scale;
	if (
		typeof scale !== "number" ||
		!Number.isFinite(scale) ||
		scale < 0 ||
		scale > NOVELAI_MAX_SCALE
	) {
		throw new Error(`${label}.scale 必须是 0 到 ${NOVELAI_MAX_SCALE} 之间的数`);
	}
	return {
		model: text(merged.model, `${label}.model`, false),
		width: intIn(
			merged.width,
			`${label}.width`,
			NOVELAI_MIN_SIZE,
			NOVELAI_MAX_SIZE,
			64,
		),
		height: intIn(
			merged.height,
			`${label}.height`,
			NOVELAI_MIN_SIZE,
			NOVELAI_MAX_SIZE,
			64,
		),
		steps: intIn(merged.steps, `${label}.steps`, 1, NOVELAI_MAX_STEPS),
		scale,
		sampler: text(merged.sampler, `${label}.sampler`, false),
		noiseSchedule: text(merged.noiseSchedule, `${label}.noiseSchedule`, false),
		sm: bool(merged.sm, `${label}.sm`),
		smDyn: bool(merged.smDyn, `${label}.smDyn`),
		varietyBoost: bool(merged.varietyBoost, `${label}.varietyBoost`),
		qualityTags: text(merged.qualityTags, `${label}.qualityTags`, true),
		negativeTags: text(merged.negativeTags, `${label}.negativeTags`, true),
	};
}
