import type { TurnCompletedPayload } from "@dramaticer/protocol";

/** 回合完成后的统计条；线索数按 `stateDiffs` 里的 id 去重。 */
export interface TurnSummary {
	readonly diffCount: number;
	readonly openedClues: number;
	readonly fulfilledClues: number;
	readonly firstTokenMs: number | null;
}

export function summarizeTurn(payload: TurnCompletedPayload): TurnSummary {
	const opened = new Set<string>();
	const fulfilled = new Set<string>();
	for (const diff of payload.stateDiffs) {
		if (diff.path[0] !== "clue" || diff.path[2] !== "status") continue;
		const clueId = diff.path[1];
		if (clueId === undefined) continue;
		if (diff.value === "open") opened.add(clueId);
		if (diff.value === "fulfilled") fulfilled.add(clueId);
	}
	return {
		diffCount: payload.stateDiffs.length,
		openedClues: opened.size,
		fulfilledClues: fulfilled.size,
		firstTokenMs: payload.firstTokenMs,
	};
}

export function describeTurnSummary(summary: TurnSummary): string {
	const parts = [
		`状态更新 ${summary.diffCount} 条`,
		`新线索 ${summary.openedClues} 条`,
		`兑现线索 ${summary.fulfilledClues} 条`,
	];
	if (summary.firstTokenMs !== null) {
		parts.push(`首字 ${formatMilliseconds(summary.firstTokenMs)}`);
	}
	return parts.join(" · ");
}

function formatMilliseconds(value: number): string {
	if (value >= 1000) {
		return `${(Math.round(value / 100) / 10).toFixed(1)} 秒`;
	}
	return `${Math.round(value)} 毫秒`;
}
