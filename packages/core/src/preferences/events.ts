import { assertPlainObject, rejectUnknownKeys } from "../json.js";

/** 偏好信号的四种来源；只用于评测与校准，不进入剧情上下文。 */
export const PREFERENCE_EVENT_KINDS = [
	"swipe",
	"choice",
	"card_decision",
	"edit",
] as const;

export type PreferenceEventKind = (typeof PREFERENCE_EVENT_KINDS)[number];

/** 变更卡的决定只记录批准与拒绝；回滚不是偏好信号。 */
export const CARD_DECISIONS = ["approved", "rejected"] as const;

export type CardDecision = (typeof CARD_DECISIONS)[number];

export interface SwipePreferencePayload {
	/** 被放弃的回复楼层。 */
	readonly abandonedNodeId: string;
	/** 被接受的新回复楼层，必须也是记录的所在楼层。 */
	readonly acceptedNodeId: string;
}

export interface ChoicePreferencePayload {
	/** 玩家选中的选项正文；所在楼层由记录的 `nodeId` 给出。 */
	readonly choiceText: string;
}

export interface CardDecisionPreferencePayload {
	readonly cardId: string;
	readonly decision: CardDecision;
}

export interface EditPreferencePayload {
	/** 编辑前的楼层。 */
	readonly beforeNodeId: string;
	/** 编辑后的新楼层，必须也是记录的所在楼层。 */
	readonly afterNodeId: string;
}

export type PreferenceEventPayload =
	| SwipePreferencePayload
	| ChoicePreferencePayload
	| CardDecisionPreferencePayload
	| EditPreferencePayload;

export interface PreferenceEvent {
	readonly id: string;
	readonly storyId: string;
	readonly nodeId: string;
	readonly kind: PreferenceEventKind;
	readonly payload: PreferenceEventPayload;
	readonly createdAt: string;
}

export type NewPreferenceEventInput = {
	readonly id?: string;
	readonly createdAt?: string;
} & (
	| {
			readonly storyId: string;
			readonly nodeId: string;
			readonly kind: "swipe";
			readonly payload: SwipePreferencePayload;
	  }
	| {
			readonly storyId: string;
			readonly nodeId: string;
			readonly kind: "choice";
			readonly payload: ChoicePreferencePayload;
	  }
	| {
			readonly storyId: string;
			readonly nodeId: string;
			readonly kind: "card_decision";
			readonly payload: CardDecisionPreferencePayload;
	  }
	| {
			readonly storyId: string;
			readonly nodeId: string;
			readonly kind: "edit";
			readonly payload: EditPreferencePayload;
	  }
);

export interface ListPreferenceEventsOptions {
	readonly kind?: PreferenceEventKind;
}

export function isPreferenceEventKind(
	value: unknown,
): value is PreferenceEventKind {
	return (
		typeof value === "string" &&
		(PREFERENCE_EVENT_KINDS as readonly string[]).includes(value)
	);
}

export function isCardDecision(value: unknown): value is CardDecision {
	return (
		typeof value === "string" &&
		(CARD_DECISIONS as readonly string[]).includes(value)
	);
}

function requireNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${path} 必须是非空字符串`);
	}
	return value;
}

/** 按种类校验载荷字段与值，拒绝未知字段，返回规范化后的副本。 */
export function assertPreferencePayload(
	kind: PreferenceEventKind,
	payload: unknown,
	path = "偏好事件的载荷",
): PreferenceEventPayload {
	const object = assertPlainObject(payload, path);
	switch (kind) {
		case "swipe": {
			rejectUnknownKeys(object, ["abandonedNodeId", "acceptedNodeId"], path);
			return {
				abandonedNodeId: requireNonEmptyString(
					object.abandonedNodeId,
					`${path}.abandonedNodeId`,
				),
				acceptedNodeId: requireNonEmptyString(
					object.acceptedNodeId,
					`${path}.acceptedNodeId`,
				),
			};
		}
		case "choice": {
			rejectUnknownKeys(object, ["choiceText"], path);
			return {
				choiceText: requireNonEmptyString(
					object.choiceText,
					`${path}.choiceText`,
				),
			};
		}
		case "card_decision": {
			rejectUnknownKeys(object, ["cardId", "decision"], path);
			const decision = object.decision;
			if (!isCardDecision(decision)) {
				throw new Error(
					`${path}.decision 只能是 ${CARD_DECISIONS.join("、")}，收到 ${String(decision)}`,
				);
			}
			return {
				cardId: requireNonEmptyString(object.cardId, `${path}.cardId`),
				decision,
			};
		}
		case "edit": {
			rejectUnknownKeys(object, ["beforeNodeId", "afterNodeId"], path);
			return {
				beforeNodeId: requireNonEmptyString(
					object.beforeNodeId,
					`${path}.beforeNodeId`,
				),
				afterNodeId: requireNonEmptyString(
					object.afterNodeId,
					`${path}.afterNodeId`,
				),
			};
		}
	}
}
