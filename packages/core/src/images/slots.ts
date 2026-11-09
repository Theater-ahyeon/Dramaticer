import {
	type JsonObject,
	type JsonValue,
	assertJsonValue,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";

/** ComfyUI API 格式的一个节点；`_meta` 等额外字段原样保留。 */
export interface ComfyUiNode {
	readonly class_type: string;
	readonly inputs: JsonObject;
	readonly [key: string]: JsonValue;
}

/** 节点 id 到节点的映射；顺序保留文件里的顺序。 */
export interface ComfyUiWorkflow {
	readonly [nodeId: string]: ComfyUiNode;
}

export const COMFYUI_SLOT_NAMES = [
	"positive",
	"negative",
	"seed",
	"width",
	"height",
] as const;

export type ComfyUiSlotName = (typeof COMFYUI_SLOT_NAMES)[number];

/** 插槽指向某个节点的某个输入。 */
export interface ComfyUiSlotRef {
	readonly nodeId: string;
	readonly input: string;
}

export interface ComfyUiSlots {
	readonly positive: ComfyUiSlotRef;
	readonly negative: ComfyUiSlotRef | null;
	readonly seed: ComfyUiSlotRef;
	readonly width: ComfyUiSlotRef | null;
	readonly height: ComfyUiSlotRef | null;
}

export type ComfyUiSlotCandidates = Readonly<
	Record<ComfyUiSlotName, readonly ComfyUiSlotRef[]>
>;

export interface ComfyUiSlotDetection {
	/** 只有单项采样器且正向提示词与 seed 都唯一时才会自动给出插槽。 */
	readonly slots: ComfyUiSlots | null;
	readonly candidates: ComfyUiSlotCandidates;
	/** 需要用户显式确认的插槽：缺少必需的候选，或出现多个候选。 */
	readonly unresolved: readonly ComfyUiSlotName[];
}

/** 校验 ComfyUI API 格式：每个节点有非空字符串 `class_type` 与对象 `inputs`。 */
export function parseComfyUiWorkflow(
	value: unknown,
	label = "workflow",
): ComfyUiWorkflow {
	assertJsonValue(value, label);
	const root = assertPlainObject(value, label);
	const ids = Object.keys(root);
	if (ids.length === 0) {
		throw new Error(`${label} 至少需要一个节点`);
	}
	for (const id of ids) {
		if (id.trim().length === 0) {
			throw new Error(`${label} 的节点 id 不能为空`);
		}
		const node = assertPlainObject(root[id], `${label}.${id}`);
		const classType = node.class_type;
		if (typeof classType !== "string" || classType.trim().length === 0) {
			throw new Error(`${label}.${id}.class_type 必须是非空字符串`);
		}
		if (
			typeof node.inputs !== "object" ||
			node.inputs === null ||
			Array.isArray(node.inputs)
		) {
			throw new Error(`${label}.${id}.inputs 必须是对象`);
		}
	}
	return root as unknown as ComfyUiWorkflow;
}

/**
 * 校验并规范化显式插槽。正向提示词与 seed 必须提供；负向提示词与
 * 尺寸可以留空。节点、输入不存在或类型不符时抛出错误并带字段路径。
 */
export function assertComfyUiSlots(
	workflow: ComfyUiWorkflow,
	value: unknown,
	label = "slots",
): ComfyUiSlots {
	const slots = assertPlainObject(value, label);
	rejectUnknownKeys(slots, COMFYUI_SLOT_NAMES, label);
	const positive = readSlotRef(slots.positive, "positive", label, true);
	const negative = readSlotRef(slots.negative, "negative", label, false);
	const seed = readSlotRef(slots.seed, "seed", label, true);
	const width = readSlotRef(slots.width, "width", label, false);
	const height = readSlotRef(slots.height, "height", label, false);
	const resolved: ComfyUiSlots = {
		positive: positive as ComfyUiSlotRef,
		negative,
		seed: seed as ComfyUiSlotRef,
		width,
		height,
	};
	for (const name of COMFYUI_SLOT_NAMES) {
		const ref = resolved[name];
		if (ref !== null) assertSlotValue(workflow, ref, name, label);
	}
	return resolved;
}

/**
 * 跟随采样器的 `positive`、`negative` 与 `latent_image` 链接识别插槽。
 * 多采样器、缺少正向提示词或 seed 时不自动采用，只返回候选。
 */
export function detectComfyUiSlots(
	workflow: ComfyUiWorkflow,
	label = "workflow",
): ComfyUiSlotDetection {
	const candidates: Record<ComfyUiSlotName, ComfyUiSlotRef[]> = {
		positive: [],
		negative: [],
		seed: [],
		width: [],
		height: [],
	};
	const samplers = Object.entries(workflow).filter(([, node]) =>
		isSamplerClass(node.class_type),
	);
	for (const [nodeId, node] of samplers) {
		const inputsPath = `${label}.${nodeId}.inputs`;
		const positive = readLinkIfPresent(
			node.inputs.positive,
			`${inputsPath}.positive`,
		);
		if (positive !== null) {
			const target = requireLinkedNode(
				workflow,
				positive,
				`${inputsPath}.positive`,
			);
			candidates.positive.push(
				...collectPromptSlots(
					workflow,
					target,
					`${inputsPath}.positive`,
					new Set(),
				),
			);
		}
		const negative = readLinkIfPresent(
			node.inputs.negative,
			`${inputsPath}.negative`,
		);
		if (negative !== null) {
			const target = requireLinkedNode(
				workflow,
				negative,
				`${inputsPath}.negative`,
			);
			candidates.negative.push(
				...collectPromptSlots(
					workflow,
					target,
					`${inputsPath}.negative`,
					new Set(),
				),
			);
		}
		const seedInput = readSeedInput(node.inputs, inputsPath);
		if (seedInput !== null) {
			candidates.seed.push({ nodeId, input: seedInput });
		}
		const latent = readLinkIfPresent(
			node.inputs.latent_image,
			`${inputsPath}.latent_image`,
		);
		if (latent !== null) {
			const targetId = requireLinkedNode(
				workflow,
				latent,
				`${inputsPath}.latent_image`,
			);
			const target = workflow[targetId] as ComfyUiNode;
			for (const name of ["width", "height"] as const) {
				if (!Object.hasOwn(target.inputs, name)) continue;
				const size = target.inputs[name];
				if (!isPositiveInteger(size)) {
					throw new Error(`${label}.${targetId}.inputs.${name} 必须是正整数`);
				}
				candidates[name].push({ nodeId: targetId, input: name });
			}
		}
	}
	const deduped: Record<ComfyUiSlotName, ComfyUiSlotRef[]> = {
		positive: dedupeRefs(candidates.positive),
		negative: dedupeRefs(candidates.negative),
		seed: dedupeRefs(candidates.seed),
		width: dedupeRefs(candidates.width),
		height: dedupeRefs(candidates.height),
	};
	const unresolved: ComfyUiSlotName[] = [];
	for (const name of COMFYUI_SLOT_NAMES) {
		const count = deduped[name].length;
		if (count > 1) unresolved.push(name);
		else if (count === 0 && (name === "positive" || name === "seed")) {
			unresolved.push(name);
		}
	}
	const singleSampler = samplers.length === 1;
	const positive = deduped.positive[0];
	const seed = deduped.seed[0];
	const slots =
		singleSampler &&
		deduped.positive.length === 1 &&
		deduped.seed.length === 1 &&
		deduped.negative.length <= 1 &&
		deduped.width.length <= 1 &&
		deduped.height.length <= 1 &&
		positive !== undefined &&
		seed !== undefined
			? {
					positive,
					negative: deduped.negative[0] ?? null,
					seed,
					width: deduped.width[0] ?? null,
					height: deduped.height[0] ?? null,
				}
			: null;
	return { slots, candidates: deduped, unresolved };
}

/** 显式插槽优先；没有显式插槽时只在自动识别成功时采用，否则抛错。 */
export function resolveComfyUiSlots(
	workflow: ComfyUiWorkflow,
	requested?: unknown,
): ComfyUiSlots {
	if (requested !== undefined) return assertComfyUiSlots(workflow, requested);
	const detection = detectComfyUiSlots(workflow);
	if (detection.slots !== null) return detection.slots;
	const reasons =
		detection.unresolved.length === 0
			? "没有唯一的插槽候选"
			: `无法确定 ${detection.unresolved.join("、")}`;
	throw new Error(`slots 无法自动解析：${reasons}；请显式指定插槽`);
}

function readSlotRef(
	value: unknown,
	name: ComfyUiSlotName,
	label: string,
	required: boolean,
): ComfyUiSlotRef | null {
	const path = `${label}.${name}`;
	if (value === undefined || value === null) {
		if (required) throw new Error(`${path} 必须提供`);
		return null;
	}
	const ref = assertPlainObject(value, path);
	rejectUnknownKeys(ref, ["nodeId", "input"], path);
	const nodeId = ref.nodeId;
	const input = ref.input;
	if (typeof nodeId !== "string" || nodeId.trim().length === 0) {
		throw new Error(`${path}.nodeId 必须是非空字符串`);
	}
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new Error(`${path}.input 必须是非空字符串`);
	}
	return { nodeId: nodeId.trim(), input: input.trim() };
}

function assertSlotValue(
	workflow: ComfyUiWorkflow,
	ref: ComfyUiSlotRef,
	name: ComfyUiSlotName,
	label: string,
): void {
	const path = `${label}.${name}`;
	const node = workflow[ref.nodeId];
	if (node === undefined) {
		throw new Error(`${path}.nodeId 指向不存在的节点 ${ref.nodeId}`);
	}
	if (!Object.hasOwn(node.inputs, ref.input)) {
		throw new Error(`${path}.input 在节点 ${ref.nodeId} 中不存在`);
	}
	const value = node.inputs[ref.input];
	if (name === "positive" || name === "negative") {
		if (typeof value !== "string") {
			throw new Error(`${path}.input 必须指向字符串输入`);
		}
		return;
	}
	if (name === "seed") {
		if (!isNonNegativeInteger(value)) {
			throw new Error(`${path}.input 必须指向非负整数输入`);
		}
		return;
	}
	if (!isPositiveInteger(value)) {
		throw new Error(`${path}.input 必须是正整数`);
	}
}

function readSeedInput(inputs: JsonObject, path: string): string | null {
	for (const name of ["seed", "noise_seed"] as const) {
		if (!Object.hasOwn(inputs, name)) continue;
		const value = inputs[name];
		if (!isNonNegativeInteger(value)) {
			throw new Error(`${path}.${name} 必须是非负整数`);
		}
		return name;
	}
	return null;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isSamplerClass(classType: string): boolean {
	return classType.startsWith("KSampler");
}

function readLinkIfPresent(
	value: JsonValue | undefined,
	path: string,
): readonly [string, number] | null {
	if (value === undefined) return null;
	return readLink(value, path);
}

function readLink(value: JsonValue, path: string): readonly [string, number] {
	if (
		!Array.isArray(value) ||
		value.length !== 2 ||
		typeof value[0] !== "string" ||
		value[0].trim().length === 0 ||
		typeof value[1] !== "number" ||
		!Number.isInteger(value[1]) ||
		value[1] < 0
	) {
		throw new Error(`${path} 必须是 [节点 id, 输出序号] 链接`);
	}
	return [value[0].trim(), value[1]];
}

function requireLinkedNode(
	workflow: ComfyUiWorkflow,
	link: readonly [string, number],
	path: string,
): string {
	const [nodeId] = link;
	if (!Object.hasOwn(workflow, nodeId)) {
		throw new Error(`${path} 指向不存在的节点 ${nodeId}`);
	}
	return nodeId;
}

function collectPromptSlots(
	workflow: ComfyUiWorkflow,
	nodeId: string,
	path: string,
	seen: Set<string>,
): ComfyUiSlotRef[] {
	if (seen.has(nodeId)) return [];
	seen.add(nodeId);
	const node = workflow[nodeId] as ComfyUiNode;
	if (Object.hasOwn(node.inputs, "text")) {
		if (typeof node.inputs.text !== "string") {
			throw new Error(`${path} 的目标节点 ${nodeId} 的 text 不是字符串`);
		}
		return [{ nodeId, input: "text" }];
	}
	const refs: ComfyUiSlotRef[] = [];
	for (const [input, value] of Object.entries(node.inputs)) {
		if (!Array.isArray(value)) continue;
		const link = readLink(value, `${path} 的节点 ${nodeId}.inputs.${input}`);
		const targetId = requireLinkedNode(
			workflow,
			link,
			`${path} 的节点 ${nodeId}.inputs.${input}`,
		);
		refs.push(...collectPromptSlots(workflow, targetId, path, seen));
	}
	seen.delete(nodeId);
	return refs;
}

function pushRefs(
	target: ComfyUiSlotRef[],
	refs: readonly ComfyUiSlotRef[],
): void {
	target.push(...refs);
}

function dedupeRefs(refs: readonly ComfyUiSlotRef[]): ComfyUiSlotRef[] {
	const seen = new Set<string>();
	const result: ComfyUiSlotRef[] = [];
	for (const ref of refs) {
		const key = `${ref.nodeId}\u0000${ref.input}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(ref);
	}
	return result;
}
