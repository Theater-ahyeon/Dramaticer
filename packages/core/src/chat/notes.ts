import {
	type DirectorNoteDiff,
	MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR,
	assertDirectorNoteDiffs,
} from "../director/notes.js";

/**
 * 运行内的导演手记修改：`note_write` 逐次追加，提交楼层时才写入
 * `director_notes`。提交前不落库，其他楼层与其他分支都读不到。
 */
export class TurnNoteController {
	#diffs: DirectorNoteDiff[] = [];

	get pending(): readonly DirectorNoteDiff[] {
		return this.#diffs;
	}

	/** 校验并追加一批修改；超过每楼上限时整批拒绝。 */
	apply(value: unknown): readonly DirectorNoteDiff[] {
		const diffs = assertDirectorNoteDiffs(value, "note_write.diffs");
		if (diffs.length === 0) {
			throw new Error("note_write.diffs 至少要有一条");
		}
		if (this.#diffs.length + diffs.length > MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR) {
			throw new Error(
				`note_write.diffs 每楼最多 ${MAX_DIRECTOR_NOTE_DIFFS_PER_FLOOR} 条，本轮已有 ${this.#diffs.length} 条`,
			);
		}
		this.#diffs.push(...diffs);
		return diffs;
	}
}
