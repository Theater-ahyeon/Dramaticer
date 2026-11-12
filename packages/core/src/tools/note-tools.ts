import { MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR } from "../director/notes.js";
import type { TurnNoteController } from "../chat/notes.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { DeepToolDefinition } from "./registry.js";

export const NOTE_WRITE_TOOL_NAME = "note_write";

const NOTE_WRITE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		diffs: {
			type: "array",
			minItems: 1,
			maxItems: MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR,
			description: "本楼层的手记修改；本轮累计最多 50 条。",
			items: {
				type: "object",
				properties: {
					action: { enum: ["set", "delete"] },
					key: { type: "string", minLength: 1 },
					text: { type: "string", maxLength: 2_000 },
				},
				required: ["action", "key"],
				additionalProperties: false,
			},
		},
	},
	required: ["diffs"],
	additionalProperties: false,
};

export interface NoteWriteOutcome {
	readonly content: string;
	readonly ok: boolean;
	readonly error: string | null;
}

/** 校验 note_write 的参数并把合法修改交给运行内的手记控制器。 */
export function executeNoteWriteTool(
	value: unknown,
	notes: TurnNoteController,
): NoteWriteOutcome {
	const args = assertPlainObject(value, NOTE_WRITE_TOOL_NAME);
	rejectUnknownKeys(args, ["diffs"], NOTE_WRITE_TOOL_NAME);
	const applied = notes.apply(args.diffs);
	return {
		content: `已记录 ${applied.length} 条手记修改（本轮共 ${notes.pending.length} 条），提交后生效。`,
		ok: true,
		error: null,
	};
}

export const NOTE_WRITE_TOOL: DeepToolDefinition = {
	name: NOTE_WRITE_TOOL_NAME,
	description:
		"写入导演手记：记录伏笔安排、人物动机与后续打算。修改在本轮提交后生效，可以覆盖或删除已有的键。",
	parameters: NOTE_WRITE_SCHEMA,
	permission: "propose",
	progressLabel: "记录手记……",
};
