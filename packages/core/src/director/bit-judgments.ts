import type { BackgroundJobHandler } from "../background/types.js";
import { requireJobNodeId } from "../background/types.js";
import {
	type DirectorBit,
	type DirectorBitJudgment,
	directorBitTextFingerprint,
} from "../director/bits.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import {
	type LlmClient,
	type LlmMessage,
	NO_CONTINUATION,
} from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";

export const DIRECTOR_BITS_JOB_KIND = "director_bits";

/** 判断输入的楼层窗口：最近 6 楼原文。 */
export const DIRECTOR_BITS_WINDOW_FLOORS = 6;

export interface DirectorBitJudgmentCondition {
	readonly id: string;
	readonly text: string;
}

export interface DirectorBitJudgmentInput {
	readonly storyId: string;
	readonly nodeId: string;
	readonly fingerprint: string;
	readonly conditions: readonly DirectorBitJudgmentCondition[];
	readonly state: unknown;
	readonly floors: readonly TimelineNode[];
}

const SYSTEM_PROMPT = [
	"你在为剧情小品的自然语言条件做判断。",
	"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如：",
	'{"judgments":[{"id":"…","matched":true,"reason":"…"}]}',
	"- judgments 必须为每一条待判断条件给出恰好一条记录，id 与输入完全一致，不许多、不许少、不许重复。",
	"- matched 表示该条件在当前台账与最近楼层下是否成立。",
	"- reason 用一句话说明依据，不要复述条件原文。",
	"- 只依据输入里的台账与楼层，不要编造没有出现过的设定。",
].join("\n");

/** 收集一批自然语言条件；没有条件时仍返回空批次，由调用方决定是否请求。 */
export function collectDirectorBitJudgmentInput(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): DirectorBitJudgmentInput | null {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new Error(`楼层节点不存在：${nodeId}`);
	}
	if (node.storyId !== storyId) {
		throw new Error(`楼层节点 ${nodeId} 属于另一个故事 ${node.storyId}`);
	}
	const bits = store.listDirectorBits(storyId);
	const conditions = textConditions(bits);
	if (conditions.length === 0) return null;
	const floors = store
		.getPathToNode(nodeId)
		.filter((item) => item.raw.trim().length > 0)
		.slice(-DIRECTOR_BITS_WINDOW_FLOORS);
	return {
		storyId,
		nodeId,
		fingerprint: directorBitTextFingerprint(bits),
		conditions,
		state: store.getStateSnapshot(nodeId).state,
		floors,
	};
}

function textConditions(
	bits: readonly DirectorBit[],
): DirectorBitJudgmentCondition[] {
	return bits.flatMap((bit) =>
		bit.condition?.kind === "text"
			? [{ id: bit.id, text: bit.condition.text }]
			: [],
	);
}

export function buildDirectorBitJudgmentUserContent(
	input: DirectorBitJudgmentInput,
): string {
	const lines: string[] = ["当前台账："];
	lines.push(JSON.stringify(input.state));
	lines.push("", "最近楼层的原文：");
	for (const floor of input.floors) {
		lines.push(`<楼层 id="${floor.id}" 角色="${floor.role}">`);
		lines.push(floor.raw);
		lines.push("</楼层>");
	}
	lines.push("", "待判断条件：");
	lines.push(JSON.stringify(input.conditions));
	return lines.join("\n");
}

/** 严格解析模型输出；缺少、多余、重复或非法的条目整批拒绝。 */
export function parseDirectorBitJudgmentResponse(
	text: string,
	expectedIds: readonly string[],
): DirectorBitJudgment[] {
	const object = assertPlainObject(
		parseJsonOutputObject(text, "条件判断"),
		"条件判断",
	);
	rejectUnknownKeys(object, ["judgments"], "条件判断");
	if (!Array.isArray(object.judgments)) {
		throw new Error("条件判断.judgments 必须是数组");
	}
	const expected = new Set(expectedIds);
	const parsed = new Map<string, DirectorBitJudgment>();
	object.judgments.forEach((value, index) => {
		const path = `条件判断.judgments[${index}]`;
		const item = assertPlainObject(value, path);
		rejectUnknownKeys(item, ["id", "matched", "reason"], path);
		if (typeof item.id !== "string" || item.id.trim().length === 0) {
			throw new Error(`${path}.id 必须是非空字符串`);
		}
		const id = item.id.trim();
		if (!expected.has(id)) {
			throw new Error(`${path}.id 不在待判断条件里：${id}`);
		}
		if (parsed.has(id)) {
			throw new Error(`${path}.id 重复：${id}`);
		}
		if (typeof item.matched !== "boolean") {
			throw new Error(`${path}.matched 必须是布尔值`);
		}
		if (typeof item.reason !== "string" || item.reason.trim().length === 0) {
			throw new Error(`${path}.reason 必须是非空字符串`);
		}
		parsed.set(id, {
			id,
			matched: item.matched,
			reason: item.reason.trim(),
		});
	});
	for (const id of expectedIds) {
		if (!parsed.has(id)) {
			throw new Error(`条件判断缺少条件 ${id}`);
		}
	}
	return expectedIds.map((id) => {
		const judgment = parsed.get(id);
		if (judgment === undefined) {
			throw new Error(`条件判断缺少条件 ${id}`);
		}
		return judgment;
	});
}

export interface DirectorBitJudgmentsHandlerOptions {
	/** 规划器专用客户端；不设置时使用任务上下文里的后台客户端。 */
	readonly client?: LlmClient;
	/** 覆盖客户端默认模型。 */
	readonly model?: string;
}

/** 后台任务：一次调用判断本楼层全部自然语言条件。 */
export function createDirectorBitJudgmentsHandler(
	options: DirectorBitJudgmentsHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		const input = collectDirectorBitJudgmentInput(store, job.storyId, nodeId);
		if (input === null) return;
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildDirectorBitJudgmentUserContent(input) },
		];
		const result = await (options.client ?? client).complete(
			{
				messages,
				model: options.model,
				temperature: 0,
				...(signal === undefined ? {} : { signal }),
			},
			NO_CONTINUATION,
		);
		const judgments = parseDirectorBitJudgmentResponse(
			result.text,
			input.conditions.map((condition) => condition.id),
		);
		store.saveDirectorBitJudgments({
			storyId: job.storyId,
			nodeId,
			fingerprint: input.fingerprint,
			judgments,
		});
	};
}
