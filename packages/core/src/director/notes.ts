import { assertPlainObject, rejectUnknownKeys } from "../json.js";

/** 手记修改动作：写入或删除一个键。 */
export const DIRECTOR_NOTE_ACTIONS = ["set", "delete"] as const;

export type DirectorNoteAction = (typeof DIRECTOR_NOTE_ACTIONS)[number];

/** 单条手记正文的最大长度。 */
export const MAX_DIRECTOR_NOTE_TEXT_CHARS = 2_000;

/** 一个楼层最多保存的手记修改条数。 */
export const MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR = 50;

/** 楼层上的一条手记修改；`set` 必须带正文，`delete` 不带正文。 */
export interface DirectorNoteDiff {
	readonly action: DirectorNoteAction;
	readonly key: string;
	readonly text?: string;
}

/** 一个楼层保存的手记修改集合。 */
export interface DirectorNoteRecord {
	readonly nodeId: string;
	readonly storyId: string;
	readonly diffs: readonly DirectorNoteDiff[];
	readonly createdAt: string;
}

export interface NewDirectorNoteInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly diffs: readonly DirectorNoteDiff[];
	readonly createdAt?: string;
}

/** 沿路径累加后的一条手记。 */
export interface DirectorNoteEntry {
	readonly key: string;
	readonly text: string;
}

/** 校验一条手记修改；字段路径写进错误信息。 */
export function assertDirectorNoteDiff(
	value: unknown,
	label: string,
): DirectorNoteDiff {
	const args = assertPlainObject(value, label);
	if (
		!(DIRECTOR_NOTE_ACTIONS as readonly string[]).includes(
			args.action as string,
		)
	) {
		throw new Error(
			`${label}.action 只能是 set 或 delete，收到 ${JSON.stringify(args.action)}`,
		);
	}
	if (typeof args.key !== "string" || args.key.trim().length === 0) {
		throw new Error(`${label}.key 必须是非空字符串`);
	}
	const key = args.key.trim();
	if (args.action === "delete") {
		rejectUnknownKeys(args, ["action", "key"], label);
		return { action: "delete", key };
	}
	rejectUnknownKeys(args, ["action", "key", "text"], label);
	if (typeof args.text !== "string") {
		throw new Error(`${label}.text 必须是字符串`);
	}
	if (args.text.length > MAX_DIRECTOR_NOTE_TEXT_CHARS) {
		throw new Error(
			`${label}.text 不能超过 ${MAX_DIRECTOR_NOTE_TEXT_CHARS} 字`,
		);
	}
	return { action: "set", key, text: args.text };
}

/** 校验一个楼层的手记修改数组；最多 50 条。 */
export function assertDirectorNoteDiffs(
	value: unknown,
	label: string,
): DirectorNoteDiff[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	if (value.length > MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR) {
		throw new Error(`${label} 最多 ${MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR} 条`);
	}
	return value.map((diff, index) =>
		assertDirectorNoteDiff(diff, `${label}[${index}]`),
	);
}

/**
 * 依次应用手记修改：`set` 覆盖同名键，`delete` 移除键；
 * 后写的楼层覆盖先前同名键。返回按键排序的条目。
 */
export function applyDirectorNoteDiffs(
	entries: readonly DirectorNoteEntry[],
	diffs: readonly DirectorNoteDiff[],
): DirectorNoteEntry[] {
	const map = new Map(entries.map((entry) => [entry.key, entry.text]));
	for (const diff of diffs) {
		if (diff.action === "set") {
			map.set(diff.key, diff.text ?? "");
		} else {
			map.delete(diff.key);
		}
	}
	return [...map.entries()]
		.map(([key, text]) => ({ key, text }))
		.sort((left, right) =>
			left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
		);
}

/** 深回合开始时注入的手记系统消息。 */
export function formatDirectorNotes(
	entries: readonly DirectorNoteEntry[],
): string {
	const lines = entries.map((entry) => `- ${entry.key}：${entry.text}`);
	return ["导演手记（跨回合的工作笔记；事实以台账为准）：", ...lines].join(
		"\n",
	);
}
