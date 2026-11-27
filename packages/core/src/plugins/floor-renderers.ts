import { parseBlocks } from "../blocks/parser.js";
import type { ParsedContent } from "../blocks/types.js";
import type { JsonValue } from "../json.js";
import type { PluginDefinition } from "./contracts.js";
import type {
	FloorRendererPayload,
	FloorRendererPlugin,
} from "./declarative.js";

/**
 * 楼层渲染插件可以申请的交互桥权限。沙箱里只存在这五个方法，
 * 每个渲染器还要在自己的定义里逐项声明；没声明的一律拒绝并记入检视器。
 */
export const FLOOR_BRIDGE_CAPABILITIES = [
	"sendMessage",
	"fillInput",
	"readState",
	"writeState",
	"openImage",
] as const;

export type FloorBridgeCapability = (typeof FLOOR_BRIDGE_CAPABILITIES)[number];

export function isFloorBridgeCapability(
	value: unknown,
): value is FloorBridgeCapability {
	return (
		typeof value === "string" &&
		(FLOOR_BRIDGE_CAPABILITIES as readonly string[]).includes(value)
	);
}

export function assertFloorBridgeCapability(
	value: unknown,
	label: string,
): FloorBridgeCapability {
	if (!isFloorBridgeCapability(value)) {
		throw new Error(
			`${label} 只能是 ${FLOOR_BRIDGE_CAPABILITIES.join("、")}，实际为 ${String(value)}`,
		);
	}
	return value;
}

/** 权限列表：允许省略，出现时不能重复。 */
export function assertFloorBridgeCapabilities(
	value: unknown,
	label: string,
): FloorBridgeCapability[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	const seen = new Set<FloorBridgeCapability>();
	return value.map((item, index) => {
		const capability = assertFloorBridgeCapability(item, `${label}[${index}]`);
		if (seen.has(capability)) {
			throw new Error(`${label} 重复声明了 ${capability}`);
		}
		seen.add(capability);
		return capability;
	});
}

/** 楼层里的一块：只给渲染器名字与块内原文，原文本身不交给它改写。 */
export interface FloorRenderBlock {
	readonly name: string;
	readonly raw: string;
}

export interface FloorRenderRequest {
	readonly nodeId: string;
	readonly raw: string;
	/** 当前楼层的可见状态（台账）；没有状态时为空。 */
	readonly state?: JsonValue;
}

export interface FloorRenderInput {
	readonly nodeId: string;
	readonly raw: string;
	readonly blocks: readonly FloorRenderBlock[];
	readonly state: JsonValue | undefined;
}

/** 渲染出的显示内容；只派生，楼层原文永远不变（I8）。 */
export interface FloorRenderedContent {
	readonly html: string;
	readonly script?: string | null;
	readonly style?: string | null;
}

export interface FloorRendererDefinition {
	/** 渲染器 id，在同一个内核里唯一。 */
	readonly id: string;
	/** 设置页与检视器里展示的名字。 */
	readonly name: string;
	/** 认领的块类型名；楼层里出现任意一个就认领。 */
	readonly blockTypes?: readonly string[];
	/** 认领的正则；与 blockTypes 是「或」的关系。 */
	readonly patterns?: readonly RegExp[];
	/** 这个渲染器要用的交互桥能力。 */
	readonly permissions?: readonly FloorBridgeCapability[];
	render(
		input: FloorRenderInput,
	): FloorRenderedContent | null | Promise<FloorRenderedContent | null>;
}

export interface RegisteredFloorRenderer {
	readonly plugin: string;
	readonly definition: FloorRendererDefinition;
}

export interface FloorRenderedFloor {
	readonly renderer: string;
	readonly name: string;
	readonly html: string;
	readonly script: string | null;
	readonly style: string | null;
	readonly permissions: readonly FloorBridgeCapability[];
}

export interface FloorRenderFailure {
	readonly renderer: string;
	readonly error: string;
}

/** 一个楼层的渲染结果；没有渲染器认领时 `floor` 为 null，正文按原生方式显示。 */
export interface FloorRenderOutcome {
	readonly floor: FloorRenderedFloor | null;
	readonly failures: readonly FloorRenderFailure[];
}

/** 楼层渲染的默认时间预算；超时的渲染器跳过，正文照常显示。 */
export const DEFAULT_FLOOR_RENDER_BUDGET_MS = 500;

export function assertFloorRendererDefinition(
	definition: FloorRendererDefinition,
): void {
	if (typeof definition.id !== "string" || definition.id.trim().length === 0) {
		throw new Error("楼层渲染器的 id 必须是非空字符串");
	}
	if (
		typeof definition.name !== "string" ||
		definition.name.trim().length === 0
	) {
		throw new Error(`楼层渲染器 ${definition.id} 的显示名必须是非空字符串`);
	}
	if (typeof definition.render !== "function") {
		throw new Error(`楼层渲染器 ${definition.id} 必须有 render 方法`);
	}
	const blockTypes = definition.blockTypes ?? [];
	for (const [index, name] of blockTypes.entries()) {
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error(
				`楼层渲染器 ${definition.id} 的 blockTypes[${index}] 必须是非空字符串`,
			);
		}
	}
	const patterns = definition.patterns ?? [];
	for (const [index, pattern] of patterns.entries()) {
		if (!(pattern instanceof RegExp)) {
			throw new Error(
				`楼层渲染器 ${definition.id} 的 patterns[${index}] 必须是正则`,
			);
		}
	}
	if (blockTypes.length === 0 && patterns.length === 0) {
		throw new Error(
			`楼层渲染器 ${definition.id} 至少要声明 blockTypes 或 patterns`,
		);
	}
	assertFloorBridgeCapabilities(
		definition.permissions,
		`楼层渲染器 ${definition.id} 的 permissions`,
	);
}

/** 楼层是否被认领：块类型命中任意一个，或正则命中原文。 */
export function floorRendererClaims(
	definition: FloorRendererDefinition,
	input: FloorRenderInput,
): boolean {
	for (const pattern of definition.patterns ?? []) {
		// 正则可能带 g 标志；每次匹配前复位，避免上一次的 lastIndex 影响判断。
		pattern.lastIndex = 0;
		if (pattern.test(input.raw)) return true;
	}
	for (const name of definition.blockTypes ?? []) {
		if (input.blocks.some((block) => block.name === name)) return true;
	}
	return false;
}

/** 把楼层原文解析成块列表；渲染器只读这些名字与块内原文。 */
export function readFloorRenderBlocks(
	raw: string,
): readonly FloorRenderBlock[] {
	const blocks: FloorRenderBlock[] = [];
	const visit = (items: readonly ParsedContent[]): void => {
		for (const item of items) {
			if (item.kind !== "block") continue;
			blocks.push({ name: item.name, raw: item.raw });
			visit(item.content);
		}
	};
	visit(parseBlocks(raw));
	return blocks;
}

/**
 * 声明里的正则写法：`/pattern/flags` 按字面量解析，其余按普通源码解析。
 * 字面量形式让跨行匹配这类需要标志的来源能原样写进 JSON。
 */
export function parseFloorRendererPattern(source: string): RegExp {
	const literal = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(source);
	if (literal !== null) {
		try {
			return new RegExp(literal[1] ?? "", literal[2]);
		} catch {
			// 字面量解析失败时按普通源码再试一次，由调用方看到真正的错误。
		}
	}
	return new RegExp(source);
}

export function escapeFloorHtml(text: string): string {
	return text
		.split("&")
		.join("&amp;")
		.split("<")
		.join("&lt;")
		.split(">")
		.join("&gt;")
		.split('"')
		.join("&quot;")
		.split("'")
		.join("&#39;");
}

/** 声明式渲染器：模板里的 `{{content}}` 换成转义后的楼层原文。 */
export function createDeclarativeFloorRenderer(
	plugin: FloorRendererPlugin,
): FloorRendererDefinition {
	const payload: FloorRendererPayload = plugin.payload;
	return {
		id: payload.id,
		name: payload.name,
		blockTypes: payload.blockTypes,
		patterns: payload.patterns.map((source) =>
			parseFloorRendererPattern(source),
		),
		permissions: payload.permissions,
		render: (input) => ({
			html: payload.template
				.split("{{content}}")
				.join(escapeFloorHtml(input.raw)),
			script: payload.script ?? null,
			style: payload.style ?? null,
		}),
	};
}

/** 声明式插件变成内核插件：装载时注册楼层渲染器，卸载时由内核回收。 */
export function createDeclarativeFloorRendererPlugin(
	plugin: FloorRendererPlugin,
): PluginDefinition {
	const definition = createDeclarativeFloorRenderer(plugin);
	return {
		name: `floor-renderer/${plugin.name}`,
		apply(context) {
			context.floorRenderer(definition);
		},
	};
}
