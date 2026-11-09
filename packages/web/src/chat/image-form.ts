import type {
	ComfyUiSlotName,
	ComfyUiSlots,
	ComfyUiWorkflow,
	ImageConfig,
	ImageMode,
} from "@dramaticer/core";
import type { ImageWorkflowDetectionView } from "@dramaticer/protocol";

export interface ImageFieldError {
	readonly path: string;
	readonly message: string;
}

export const IMAGE_MODE_CHOICES: readonly {
	readonly value: ImageMode;
	readonly label: string;
}[] = [
	{ value: "off", label: "关闭" },
	{ value: "manual", label: "手动" },
	{ value: "auto", label: "自动（模型可以调用 illustrate）" },
];

export const IMAGE_SLOT_NAMES = [
	"positive",
	"negative",
	"seed",
	"width",
	"height",
] as const satisfies readonly ComfyUiSlotName[];

export const IMAGE_SLOT_LABELS: Readonly<Record<ComfyUiSlotName, string>> = {
	positive: "正向提示词",
	negative: "负向提示词",
	seed: "seed",
	width: "宽度",
	height: "高度",
};

const REQUIRED_SLOTS: readonly ComfyUiSlotName[] = ["positive", "seed"];

const IMAGE_FIELD_LABELS: Readonly<Record<string, string>> = {
	mode: "生图模式",
	workflowId: "生图 workflow",
	maxPerFloor: "每楼最多插图",
	minFloorsBetween: "两次插图的最小楼层间隔",
};

export interface ImageSettingsDraft {
	readonly mode: ImageMode;
	readonly workflowId: string;
	readonly maxPerFloor: string;
	readonly minFloorsBetween: string;
}

export function buildImageSettingsDraft(
	config: ImageConfig,
): ImageSettingsDraft {
	return {
		mode: config.mode,
		workflowId: config.workflowId,
		maxPerFloor: String(config.maxPerFloor),
		minFloorsBetween: String(config.minFloorsBetween),
	};
}

/** 与服务端 `assertImageConfig` 同一套范围；关闭模式下 workflow 可以留空。 */
export function parseImageSettingsDraft(draft: ImageSettingsDraft): {
	readonly config: ImageConfig;
	readonly errors: readonly ImageFieldError[];
} {
	const errors: ImageFieldError[] = [];
	const maxPerFloor = parseBoundedInteger(
		draft.maxPerFloor,
		"imageConfig.maxPerFloor",
		1,
		4,
		errors,
	);
	const minFloorsBetween = parseBoundedInteger(
		draft.minFloorsBetween,
		"imageConfig.minFloorsBetween",
		0,
		100,
		errors,
	);
	const workflowId = draft.workflowId.trim();
	if (draft.mode !== "off" && workflowId.length === 0) {
		errors.push({
			path: "imageConfig.workflowId",
			message: "生图模式不是关闭时必须选择 workflow",
		});
	}
	return {
		config: {
			mode: draft.mode,
			workflowId,
			maxPerFloor: maxPerFloor ?? 1,
			minFloorsBetween: minFloorsBetween ?? 0,
		},
		errors,
	};
}

/** 服务端 `details.path` 里 `imageConfig.*` 的中文名。 */
export function describeImageConfigPath(path: string): string {
	const prefix = "imageConfig.";
	const key = path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return `生图配置·${IMAGE_FIELD_LABELS[key] ?? key}`;
}

export function describeImageErrorPath(path: string): string {
	if (path.startsWith("slots.")) {
		const slot = path.slice("slots.".length);
		return (
			(IMAGE_SLOT_LABELS as Readonly<Record<string, string>>)[slot] ?? slot
		);
	}
	if (path === "name") return "workflow 名称";
	if (path === "workflow") return "workflow 文件";
	return path;
}

function parseBoundedInteger(
	text: string,
	path: string,
	minimum: number,
	maximum: number,
	errors: ImageFieldError[],
): number | null {
	const value = Number(text.trim());
	if (
		text.trim().length === 0 ||
		!Number.isInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		errors.push({
			path,
			message: `${describeImageConfigPath(path)} 必须是 ${minimum} 到 ${maximum} 之间的整数`,
		});
		return null;
	}
	return value;
}

export function workflowNameFromFile(fileName: string): string {
	const trimmed = fileName.trim();
	const withoutExtension = trimmed.replace(/\.json$/i, "");
	return withoutExtension.length === 0 ? trimmed : withoutExtension;
}

/** 本地只做 JSON 语法检查；结构与插槽由服务端的 detect 校验。 */
export function parseWorkflowText(text: string): {
	readonly workflow: ComfyUiWorkflow | null;
	readonly error: string | null;
} {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			workflow: null,
			error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return { workflow: null, error: "workflow 必须是 JSON 对象" };
	}
	return { workflow: value as ComfyUiWorkflow, error: null };
}

export type WorkflowSlotSelections = Readonly<Record<ComfyUiSlotName, string>>;

export function emptySlotSelections(): WorkflowSlotSelections {
	return {
		positive: "",
		negative: "",
		seed: "",
		width: "",
		height: "",
	};
}

/** detect 自动给出的插槽转成下拉框的选中值；没有候选时留空。 */
export function defaultSlotSelections(
	detection: ImageWorkflowDetectionView,
): WorkflowSlotSelections {
	const selections = { ...emptySlotSelections() };
	for (const slot of IMAGE_SLOT_NAMES) {
		const chosen = detection.slots?.[slot] ?? null;
		if (chosen === null) continue;
		const index = detection.candidates[slot].findIndex(
			(ref) => ref.nodeId === chosen.nodeId && ref.input === chosen.input,
		);
		selections[slot] = index < 0 ? "" : String(index);
	}
	return selections;
}

/** 把下拉框的选择转成导入接口的 `slots`；候选被替换时按当前候选解析。 */
export function resolveImportSlots(
	detection: ImageWorkflowDetectionView,
	selections: WorkflowSlotSelections,
): {
	readonly slots: ComfyUiSlots | null;
	readonly errors: readonly ImageFieldError[];
} {
	const errors: ImageFieldError[] = [];
	const resolved: Partial<Record<ComfyUiSlotName, unknown>> = {};
	for (const slot of IMAGE_SLOT_NAMES) {
		const raw = selections[slot];
		const candidates = detection.candidates[slot];
		if (raw.length === 0) {
			if (REQUIRED_SLOTS.includes(slot)) {
				errors.push({
					path: `slots.${slot}`,
					message: `请选择${IMAGE_SLOT_LABELS[slot]}插槽`,
				});
			} else {
				resolved[slot] = null;
			}
			continue;
		}
		const index = Number(raw);
		const ref = candidates[index];
		if (
			!Number.isInteger(index) ||
			index < 0 ||
			index >= candidates.length ||
			ref === undefined
		) {
			errors.push({
				path: `slots.${slot}`,
				message: `${IMAGE_SLOT_LABELS[slot]}插槽不在候选里`,
			});
			continue;
		}
		resolved[slot] = ref;
	}
	if (errors.length > 0) return { slots: null, errors };
	return {
		slots: resolved as unknown as ComfyUiSlots,
		errors: [],
	};
}

export function slotRefLabel(nodeId: string, input: string): string {
	return `${nodeId} · ${input}`;
}
