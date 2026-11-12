/** 待处理的追加要求上限；达到后拒绝新的追加，直到下一个步骤取走。 */
export const MAX_TURN_GUIDANCE_ENTRIES = 5;

/** 单条追加要求去空白后的字数上限。 */
export const MAX_TURN_GUIDANCE_LENGTH = 2_000;

/** 追加要求作为用户消息进入消息序列时的前缀。 */
export const TURN_GUIDANCE_PREFIX = "【玩家在运行中追加的指引】";

export type TurnGuidanceErrorReason =
	| "closed"
	| "empty"
	| "too_long"
	| "queue_full";

/** 追加要求被拒绝的原因；调用方据此映射成 HTTP 状态或界面提示。 */
export class TurnGuidanceError extends Error {
	readonly reason: TurnGuidanceErrorReason;

	constructor(reason: TurnGuidanceErrorReason, message: string) {
		super(message);
		this.name = "TurnGuidanceError";
		this.reason = reason;
	}
}

/** 深回合运行暴露给调用方的控制句柄。 */
export interface TurnRunHandle {
	readonly runId: string;
	pushGuidance(text: string): void;
}

/** 运行开始后、第一次模型请求前交给调用方的启动信息；快回合没有句柄。 */
export interface TurnStartedInfo {
	readonly runId: string | null;
	readonly handle: TurnRunHandle | null;
}

/**
 * 运行内的追加要求队列：每次请求前由执行器整批取走，作为新的用户消息
 * 追加到消息序列。队列只保存文本，不写楼层也不改原文。
 */
export class TurnGuidanceController {
	readonly runId: string;
	readonly #onAccepted: (text: string) => void;
	#pending: string[] = [];
	#closed = false;

	constructor(runId: string, onAccepted: (text: string) => void = () => {}) {
		this.runId = runId;
		this.#onAccepted = onAccepted;
	}

	get closed(): boolean {
		return this.#closed;
	}

	get pendingCount(): number {
		return this.#pending.length;
	}

	/** 校验并接受一条指引；顺序由调用方的同步调用顺序决定。 */
	push(text: string): void {
		if (this.#closed) {
			throw new TurnGuidanceError("closed", "运行已经结束，不能再追加要求");
		}
		const normalized = text.trim();
		if (normalized.length === 0) {
			throw new TurnGuidanceError("empty", "追加的要求必须是非空字符串");
		}
		if (normalized.length > MAX_TURN_GUIDANCE_LENGTH) {
			throw new TurnGuidanceError(
				"too_long",
				`追加的要求最多 ${MAX_TURN_GUIDANCE_LENGTH} 字，当前 ${normalized.length} 字`,
			);
		}
		if (this.#pending.length >= MAX_TURN_GUIDANCE_ENTRIES) {
			throw new TurnGuidanceError(
				"queue_full",
				`待处理的追加要求最多 ${MAX_TURN_GUIDANCE_ENTRIES} 条，运行还没有进入下一步`,
			);
		}
		this.#onAccepted(normalized);
		this.#pending.push(normalized);
	}

	/** 取走全部待处理指引；没有时返回空数组。 */
	drain(): readonly string[] {
		const drained = this.#pending;
		this.#pending = [];
		return drained;
	}

	/** 运行结束后关闭；之后任何追加都被拒绝。 */
	close(): void {
		this.#closed = true;
		this.#pending = [];
	}
}

export function formatGuidanceMessage(text: string): string {
	return `${TURN_GUIDANCE_PREFIX}\n${text}`;
}
