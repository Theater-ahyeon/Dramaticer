import type { JsonObject } from "../json.js";
import { DEFAULT_MECHANISM_KERNEL } from "../plugins/mechanisms.js";
import type { StoryStore } from "../store/story-store.js";
import { assertDirectorConfig, evaluateDirector } from "./evaluate.js";
import {
	DIRECTOR_ACTION_PRIORITY,
	type DirectorPush,
	type DirectorWhen,
	readDirectorActionInput,
	readPlayerIntent,
	selectDirectorAction,
} from "./lines.js";
import type {
	DirectorConfig,
	DirectorMechanism,
	DirectorSuggestion,
} from "./types.js";

/**
 * 导演的组织方式：v3 的机制序列（已有故事仍在用）与 v4 的线与动作引擎。
 * `bits` 只为读旧库保留，运行时按 `lines` 处理（ADR-0166）。
 */
export const DIRECTOR_ORGANIZATION_KINDS = [
	"mechanisms",
	"bits",
	"lines",
] as const;

export type DirectorOrganizationKind =
	(typeof DIRECTOR_ORGANIZATION_KINDS)[number];

/**
 * 新故事默认用 v4 的线与动作引擎：功能页的「导演」开关、不干预与突发延后
 * 只在这套引擎里生效（ADR-0161）。已有故事保存的值不变。
 */
export const DEFAULT_DIRECTOR_ORGANIZATION: DirectorOrganizationKind = "lines";

export function isDirectorOrganizationKind(
	value: unknown,
): value is DirectorOrganizationKind {
	return (
		typeof value === "string" &&
		(DIRECTOR_ORGANIZATION_KINDS as readonly string[]).includes(value)
	);
}

export function assertDirectorOrganizationKind(
	value: unknown,
	label = "导演的组织方式",
): DirectorOrganizationKind {
	if (!isDirectorOrganizationKind(value)) {
		throw new Error(`${label}不合法：${String(value)}`);
	}
	return value;
}

export interface DirectorEngineInput {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly nodeId: string;
	readonly config: DirectorConfig;
	/** 单轮推进档位；不设置时是常规回合。 */
	readonly push?: DirectorPush | null;
	/** 导演何时出手；不设置时按「始终」处理。 */
	readonly when?: DirectorWhen;
}

/**
 * 导演的统一评估接口。组织方式决定内部怎么选出一条建议，
 * 调用方只传种类，不接触具体机制或小品。
 */
export interface DirectorEngine {
	readonly kind: DirectorOrganizationKind;
	/**
	 * 故事设置里存的是已删除的组织方式（目前是 `bits`，ADR-0166）时为那个旧值，
	 * 引擎按 `lines` 运行；Trace 据此注明。正常时为 null。
	 */
	readonly retiredKind: DirectorOrganizationKind | null;
	/** 机制型引擎的机制名，用于上下文包指纹；其他组织形式为 null。 */
	readonly mechanismNames: readonly string[] | null;
	/** 评估并写入本楼层的决策记录；导演关闭时返回 null 且不写记录。 */
	evaluate(input: DirectorEngineInput): DirectorSuggestion | null;
}

export interface CreateDirectorEngineOptions {
	/** 机制型引擎使用的机制序列；不设置时使用内核里的内置机制。 */
	readonly mechanisms?: readonly DirectorMechanism[];
}

/** 按组织方式创建导演引擎。 */
export function createDirectorEngine(
	kind: DirectorOrganizationKind = DEFAULT_DIRECTOR_ORGANIZATION,
	options: CreateDirectorEngineOptions = {},
): DirectorEngine {
	assertDirectorOrganizationKind(kind);
	switch (kind) {
		case "mechanisms": {
			const mechanisms =
				options.mechanisms ?? DEFAULT_MECHANISM_KERNEL.mechanisms();
			return {
				kind,
				retiredKind: null,
				mechanismNames: mechanisms.map((mechanism) => mechanism.name),
				evaluate(input) {
					if (yieldsToPlayer(input, kind)) return null;
					return evaluateDirector({
						store: input.store,
						storyId: input.storyId,
						nodeId: input.nodeId,
						config: input.config,
						mechanisms,
					});
				},
			};
		}
		// X2 的小品引擎未胜出并已删除（ADR-0134、ADR-0166）；旧值按线引擎运行。
		case "bits":
		case "lines":
			return {
				kind: "lines",
				retiredKind: kind === "bits" ? kind : null,
				mechanismNames: null,
				evaluate(input) {
					return evaluateDirectorLines(input);
				},
			};
	}
}

/**
 * 「仅推进时」的总闸：玩家这一轮写了自己的行动，导演什么都不加，
 * 只留一条说明原因的决策记录。线引擎在动作选择里自己处理让位。
 */
function yieldsToPlayer(
	input: DirectorEngineInput,
	organization: DirectorOrganizationKind,
): boolean {
	if (input.when !== "push" || input.config.mode === "off") return false;
	const path = input.store.getPathToNode(input.nodeId);
	const lastPlayer = [...path].reverse().find((node) => node.role === "user");
	const intent = readPlayerIntent(
		lastPlayer === undefined ? null : lastPlayer.raw,
		input.push ?? null,
	);
	if (intent.kind !== "free") return false;
	input.store.saveDirectorDecision({
		nodeId: input.nodeId,
		storyId: input.storyId,
		directive: null,
		mechanisms: [{ name: "intent", triggered: false, reason: intent.basis }],
		signals: { organization, intent: intent.kind, action: "yield" },
	});
	return true;
}

/**
 * 线与动作引擎：读场记记录与线状态，由程序选一个动作并写进决策记录。
 * 全程不调用模型；理由写进机制条目与信号，`explain` 可读。
 */
function evaluateDirectorLines(
	input: DirectorEngineInput,
): DirectorSuggestion | null {
	const { store, storyId, nodeId, config } = input;
	assertDirectorConfig(config);
	if (!store.getStory(storyId)) {
		throw new Error(`故事不存在：${storyId}`);
	}
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	if (config.mode === "off") return null;
	const actionInput = readDirectorActionInput(
		store,
		storyId,
		nodeId,
		config,
		input.push ?? null,
		input.when ?? "always",
	);
	const selection = selectDirectorAction(actionInput);
	if (selection === null) {
		store.saveDirectorDecision({
			nodeId,
			storyId,
			directive: null,
			mechanisms: [
				{ name: "action", triggered: false, reason: "没有可用的动作条件" },
			],
			signals: {
				organization: "lines",
				action: null,
				push: input.push ?? null,
				floorDepth: actionInput.floorDepth,
				recentActions: [...actionInput.recentActions],
			},
		});
		return null;
	}
	const signals: JsonObject = {
		organization: "lines",
		...selection.signals,
	};
	// 让位的指令为空：记下决策，不向写作模型注入任何东西。
	const directive = selection.directive === "" ? null : selection.directive;
	store.saveDirectorDecision({
		nodeId,
		storyId,
		directive,
		mechanisms: [{ name: "action", triggered: true, reason: selection.reason }],
		signals,
	});
	if (directive === null) return null;
	return {
		mechanism: `action:${selection.action}`,
		priority: DIRECTOR_ACTION_PRIORITY,
		directive: selection.directive,
		signals,
	};
}
