import { evaluateContextCondition } from "../context/template.js";
import type { JsonObject } from "../json.js";
import { DEFAULT_MECHANISM_KERNEL } from "../plugins/mechanisms.js";
import type { StoryStore } from "../store/story-store.js";
import {
	DIRECTOR_BIT_RECORD_NAME,
	type DirectorBit,
	type DirectorBitJudgment,
	directorBitTextFingerprint,
	readSelectedDirectorBit,
} from "./bits.js";
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
	DirectorMechanismRecord,
	DirectorSuggestion,
} from "./types.js";

/** 导演的组织方式；X2 的两个候选与 v4 的线与动作引擎。 */
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
		case "bits":
			return {
				kind,
				mechanismNames: null,
				evaluate(input) {
					if (yieldsToPlayer(input, kind)) return null;
					return evaluateDirectorBits(input);
				},
			};
		case "lines":
			return {
				kind,
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

interface EligibleBit {
	readonly bit: DirectorBit;
	readonly reason: string;
}

/**
 * 剧情小品引擎：台账查询当场判定，自然语言条件读间隙里写入的楼层缓存；
 * 冷却、顺序约束、可否重复与兜底全部由程序执行。整个过程不调用模型。
 */
function evaluateDirectorBits(
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
	const bits = store.listDirectorBits(storyId);
	const reasons = new Map<string, string>();
	const details: JsonObject[] = [];
	const eligible: EligibleBit[] = [];

	if (bits.length === 0) {
		store.saveDirectorDecision({
			nodeId,
			storyId,
			directive: null,
			mechanisms: [
				{
					name: DIRECTOR_BIT_RECORD_NAME,
					triggered: false,
					reason: "没有可用的剧情小品",
				},
			],
			signals: { organization: "bits", selected: null, evaluated: [] },
		});
		return null;
	}

	const path = store.getPathToNode(nodeId);
	const positions = new Map(
		path.map((node, index) => [node.id, index] as const),
	);
	const currentPosition = path.length - 1;
	const lastFired = new Map<string, number>();
	for (const decision of store.getDirectorDecisionsAlongPath(nodeId)) {
		if (decision.nodeId === nodeId) continue;
		const selected = readSelectedDirectorBit(decision.signals);
		if (selected === null) continue;
		const position = positions.get(decision.nodeId);
		if (position === undefined) continue;
		const previous = lastFired.get(selected);
		if (previous === undefined || position > previous) {
			lastFired.set(selected, position);
		}
	}

	const fingerprint = directorBitTextFingerprint(bits);
	const cached = store.findDirectorBitJudgments(nodeId);
	const judgments =
		cached !== null &&
		cached.storyId === storyId &&
		cached.fingerprint === fingerprint
			? new Map(cached.judgments.map((item) => [item.id, item] as const))
			: new Map<string, DirectorBitJudgment>();
	const state = store.getStateSnapshot(nodeId).state;

	for (const bit of bits) {
		const detail: JsonObject = {
			id: bit.id,
			priority: bit.priority,
			condition: bit.condition?.kind ?? "fallback",
			matched: null,
			triggered: false,
			reason: "",
		};
		const conditionReason = evaluateBitCondition(bit, state, judgments);
		if (conditionReason.kind === "missing") {
			reasons.set(bit.id, conditionReason.reason);
			detail.reason = conditionReason.reason;
			details.push(detail);
			continue;
		}
		detail.matched = conditionReason.matched;
		if (!conditionReason.matched) {
			reasons.set(bit.id, conditionReason.reason);
			detail.reason = conditionReason.reason;
			details.push(detail);
			continue;
		}
		if (!bit.repeatable && lastFired.has(bit.id)) {
			reasons.set(bit.id, "不可重复且已经在当前路径上触发");
			detail.reason = "不可重复且已经在当前路径上触发";
			details.push(detail);
			continue;
		}
		const last = lastFired.get(bit.id);
		if (last !== undefined && currentPosition - last <= bit.cooldown) {
			const remaining = bit.cooldown - (currentPosition - last) + 1;
			const reason = `仍在冷却，还需 ${remaining} 个楼层`;
			reasons.set(bit.id, reason);
			detail.reason = reason;
			details.push(detail);
			continue;
		}
		if (bit.after !== null && !lastFired.has(bit.after)) {
			const reason = `顺序约束未满足：${bit.after} 尚未触发`;
			reasons.set(bit.id, reason);
			detail.reason = reason;
			details.push(detail);
			continue;
		}
		reasons.set(bit.id, conditionReason.reason);
		detail.reason = conditionReason.reason;
		details.push(detail);
		eligible.push({ bit, reason: conditionReason.reason });
	}

	const regular = eligible.filter((item) => !item.bit.fallback);
	const fallbacks = eligible.filter((item) => item.bit.fallback);
	const chosen = highestPriority(regular) ?? highestPriority(fallbacks) ?? null;
	if (chosen !== null) {
		const previous = reasons.get(chosen.bit.id) ?? "条件成立";
		reasons.set(chosen.bit.id, `命中：${previous}`);
	}
	for (const item of eligible) {
		if (chosen !== null && item.bit.id === chosen.bit.id) continue;
		reasons.set(
			item.bit.id,
			item.bit.fallback && regular.length > 0
				? "兜底小品：已有普通小品命中"
				: `优先级低于 ${chosen?.bit.id ?? "其他小品"}`,
		);
	}
	const records: DirectorMechanismRecord[] = bits.map((bit) => ({
		name: bit.id,
		triggered: chosen !== null && chosen.bit.id === bit.id,
		reason: reasons.get(bit.id) ?? "未评估",
	}));
	for (const detail of details) {
		const id = detail.id;
		if (typeof id !== "string") continue;
		detail.triggered = chosen !== null && chosen.bit.id === id;
		detail.reason = reasons.get(id) ?? detail.reason;
	}
	const suggestion =
		chosen === null
			? null
			: {
					mechanism: chosen.bit.id,
					priority: chosen.bit.priority,
					directive: chosen.bit.instruction,
					signals: {
						bitId: chosen.bit.id,
						condition: chosen.bit.condition?.kind ?? "fallback",
					},
				};

	store.saveDirectorDecision({
		nodeId,
		storyId,
		directive: suggestion === null ? null : suggestion.directive,
		mechanisms: records,
		signals: {
			organization: "bits",
			selected: chosen === null ? null : chosen.bit.id,
			evaluated: details,
		},
	});
	return suggestion;
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

function highestPriority(items: readonly EligibleBit[]): EligibleBit | null {
	let best: EligibleBit | null = null;
	for (const item of items) {
		if (best === null || item.bit.priority > best.bit.priority) {
			best = item;
		}
	}
	return best;
}

interface BitConditionResult {
	readonly kind: "judged" | "missing";
	readonly matched: boolean;
	readonly reason: string;
}

function evaluateBitCondition(
	bit: DirectorBit,
	state: unknown,
	judgments: ReadonlyMap<string, DirectorBitJudgment>,
): BitConditionResult {
	if (bit.fallback) {
		return { kind: "judged", matched: true, reason: "兜底小品" };
	}
	if (bit.condition === null) {
		throw new Error(`剧情小品 ${bit.id} 没有条件也没有标记为兜底`);
	}
	if (bit.condition.kind === "ledger") {
		const matched = evaluateContextCondition(bit.condition.query, {
			switches: {},
			state,
		});
		return {
			kind: "judged",
			matched,
			reason: matched ? "台账条件成立" : "台账条件不成立",
		};
	}
	const judgment = judgments.get(bit.id);
	if (judgment === undefined) {
		return {
			kind: "missing",
			matched: false,
			reason: "自然语言条件的判断结果缺失",
		};
	}
	return {
		kind: "judged",
		matched: judgment.matched,
		reason: judgment.reason,
	};
}
