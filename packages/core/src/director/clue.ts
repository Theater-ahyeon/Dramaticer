import type { JsonObject } from "../json.js";
import type { PlotNote } from "../memory/plot-note.js";
import type {
	DirectorMechanism,
	DirectorMechanismContext,
	DirectorMechanismResult,
} from "./types.js";

/** 线索过老比打开过多更需要优先处理：两种情况都指向同一条最老线索。 */
export const CLUE_AGE_PRIORITY = 30;
export const CLUE_COUNT_PRIORITY = 20;

/**
 * 线索追踪：只看当前分支上的未兑现笔记，年龄是当前位置减去来源楼层的位置。
 * 超过年龄阈值或达到打开数量上限时给出回收建议。
 */
export function createClueTrackingMechanism(): DirectorMechanism {
	return {
		name: "clue",
		evaluate(context: DirectorMechanismContext): DirectorMechanismResult {
			const { store, storyId, nodeId, config } = context;
			const path = store.getPathToNode(nodeId);
			const positions = new Map(
				path.map((node, index) => [node.id, index] as const),
			);
			const currentPosition = path.length - 1;
			const notes = store
				.getOpenPlotNotes(storyId)
				.filter((note) => positions.has(note.sourceNodeId));

			let oldest: { readonly note: PlotNote; readonly age: number } | null =
				null;
			for (const note of notes) {
				const createdPosition = positions.get(note.sourceNodeId);
				if (createdPosition === undefined) {
					throw new Error(`剧情笔记 ${note.id} 的来源楼层不在当前路径上`);
				}
				const age = currentPosition - createdPosition;
				if (oldest === null || age > oldest.age) {
					oldest = { note, age };
				}
			}

			const signals: JsonObject = {
				openClues: notes.length,
				oldestAge: oldest === null ? null : oldest.age,
				selectedNoteId: oldest === null ? null : oldest.note.id,
				clueAgeWarning: config.clueAgeWarning,
				maxOpenClues: config.maxOpenClues,
			};
			if (oldest === null) {
				return {
					triggered: false,
					reason: "当前分支没有未兑现剧情笔记",
					suggestion: null,
					signals,
				};
			}

			const ageTriggered = oldest.age > config.clueAgeWarning;
			const countTriggered = notes.length >= config.maxOpenClues;
			if (!ageTriggered && !countTriggered) {
				return {
					triggered: false,
					reason: `最老线索搁置 ${oldest.age} 楼，未超过阈值 ${config.clueAgeWarning}；未兑现 ${notes.length} 条，未达到上限 ${config.maxOpenClues}`,
					suggestion: null,
					signals,
				};
			}

			const reasons: string[] = [];
			if (ageTriggered) {
				reasons.push(
					`最老线索搁置 ${oldest.age} 楼，超过阈值 ${config.clueAgeWarning}`,
				);
			}
			if (countTriggered) {
				reasons.push(
					`未兑现 ${notes.length} 条，达到上限 ${config.maxOpenClues}`,
				);
			}
			const directive = ageTriggered
				? `线索「${oldest.note.text}」已搁置 ${oldest.age} 楼，请让本轮剧情推动它兑现。`
				: `当前分支有 ${notes.length} 条未兑现线索，先推动最老的一条「${oldest.note.text}」（已搁置 ${oldest.age} 楼）。`;
			return {
				triggered: true,
				reason: reasons.join("；"),
				suggestion: {
					mechanism: "clue",
					priority: ageTriggered ? CLUE_AGE_PRIORITY : CLUE_COUNT_PRIORITY,
					directive,
					signals,
				},
				signals,
			};
		},
	};
}
