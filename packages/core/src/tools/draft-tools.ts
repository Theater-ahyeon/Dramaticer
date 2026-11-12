import type { TurnDraftController } from "../chat/draft.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { DeepToolDefinition } from "./registry.js";

export const DRAFT_WRITE_TOOL_NAME = "draft_write";
export const COMMIT_DRAFT_TOOL_NAME = "commit_draft";

const DRAFT_WRITE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		text: {
			type: "string",
			description: "完整替换当前草稿的正文。",
		},
	},
	required: ["text"],
	additionalProperties: false,
};

const COMMIT_DRAFT_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {},
	additionalProperties: false,
};

export interface DraftToolOutcome {
	readonly content: string;
	readonly ok: boolean;
	readonly error: string | null;
}

/** 校验 draft_write 的参数并整份替换草稿。 */
export function executeDraftWriteTool(
	value: unknown,
	draft: TurnDraftController,
): DraftToolOutcome {
	const args = assertPlainObject(value, DRAFT_WRITE_TOOL_NAME);
	rejectUnknownKeys(args, ["text"], DRAFT_WRITE_TOOL_NAME);
	if (typeof args.text !== "string") {
		throw new Error(`${DRAFT_WRITE_TOOL_NAME}.text 必须是字符串`);
	}
	const snapshot = draft.replace(args.text);
	return {
		content: `草稿已替换为第 ${snapshot.version} 版（${snapshot.text.length} 字）。`,
		ok: true,
		error: null,
	};
}

/** 校验 commit_draft 的参数并提交草稿；重复提交抛错交给执行器写成工具错误。 */
export function executeDraftCommitTool(
	value: unknown,
	draft: TurnDraftController,
): DraftToolOutcome {
	const args = assertPlainObject(value, COMMIT_DRAFT_TOOL_NAME);
	rejectUnknownKeys(args, [], COMMIT_DRAFT_TOOL_NAME);
	const snapshot = draft.commit("tool");
	return {
		content: `草稿已提交为第 ${snapshot.version} 版（${snapshot.text.length} 字）。`,
		ok: true,
		error: null,
	};
}

export const DRAFT_WRITE_TOOL: DeepToolDefinition = {
	name: DRAFT_WRITE_TOOL_NAME,
	description:
		"整份替换本轮正文草稿。草稿只有提交后才会成为楼层；提交前可以反复修改。",
	parameters: DRAFT_WRITE_SCHEMA,
	permission: "control",
	progressLabel: "整理草稿……",
};

export const COMMIT_DRAFT_TOOL: DeepToolDefinition = {
	name: COMMIT_DRAFT_TOOL_NAME,
	description:
		"把当前草稿提交为助手楼层并结束本轮。提交后不能再写入草稿。",
	parameters: COMMIT_DRAFT_SCHEMA,
	permission: "control",
	progressLabel: "提交正文……",
};
