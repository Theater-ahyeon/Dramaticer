/** 深回合的一次草稿快照：版本号从 1 开始，正文按整份替换。 */
export interface TurnDraftSnapshot {
	readonly text: string;
	readonly version: number;
}

/** 草稿怎么提交：模型调用工具，或运行结束时按漂移规则自动提交。 */
export type DraftCommitMethod = "tool" | "auto";

export interface TurnDraftControllerOptions {
	/** 每次整份替换后的快照；服务端用它发 SSE。 */
	readonly onReplace?: (draft: TurnDraftSnapshot) => void;
	/** 提交时的快照与方式；运行日志用它写 draft.commit。 */
	readonly onCommit?: (
		draft: TurnDraftSnapshot,
		method: DraftCommitMethod,
	) => void;
}

/**
 * 运行内的草稿：提交之前只存在内存里，不写楼层、不进历史、不参与台账。
 * 提交之后拒绝继续替换与重复提交，调用方把错误交给模型作为工具结果。
 */
export class TurnDraftController {
	readonly #onReplace: ((draft: TurnDraftSnapshot) => void) | undefined;
	readonly #onCommit:
		| ((draft: TurnDraftSnapshot, method: DraftCommitMethod) => void)
		| undefined;
	#text = "";
	#version = 0;
	#commitMethod: DraftCommitMethod | null = null;

	constructor(options: TurnDraftControllerOptions = {}) {
		this.#onReplace = options.onReplace;
		this.#onCommit = options.onCommit;
	}

	get text(): string {
		return this.#text;
	}

	get version(): number {
		return this.#version;
	}

	get committed(): boolean {
		return this.#commitMethod !== null;
	}

	get commitMethod(): DraftCommitMethod | null {
		return this.#commitMethod;
	}

	snapshot(): TurnDraftSnapshot {
		return { text: this.#text, version: this.#version };
	}

	replace(text: string): TurnDraftSnapshot {
		if (this.#commitMethod !== null) {
			throw new Error("草稿已经提交，不能再写入");
		}
		if (typeof text !== "string") {
			throw new Error("草稿正文必须是字符串");
		}
		if (text.trim().length === 0) {
			throw new Error("草稿正文不能为空");
		}
		this.#text = text;
		this.#version += 1;
		const snapshot = this.snapshot();
		this.#onReplace?.(snapshot);
		return snapshot;
	}

	commit(method: DraftCommitMethod = "tool"): TurnDraftSnapshot {
		if (this.#commitMethod !== null) {
			throw new Error("草稿已经提交");
		}
		if (this.#text.trim().length === 0) {
			throw new Error("草稿为空，不能提交");
		}
		if (method !== "tool" && method !== "auto") {
			throw new Error(`草稿提交方式不合法：${String(method)}`);
		}
		this.#commitMethod = method;
		const snapshot = this.snapshot();
		this.#onCommit?.(snapshot, method);
		return snapshot;
	}
}
