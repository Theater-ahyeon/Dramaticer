export type PlotNoteStatus = "open" | "fulfilled";

export interface PlotNote {
	readonly id: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly text: string;
	readonly status: PlotNoteStatus;
	readonly createdAt: string;
	readonly fulfilledAt: string | null;
}

export interface NewPlotNoteInput {
	readonly id?: string;
	readonly storyId: string;
	readonly sourceNodeId: string;
	readonly text: string;
	readonly createdAt?: string;
}

export function isPlotNoteStatus(value: unknown): value is PlotNoteStatus {
	return value === "open" || value === "fulfilled";
}
