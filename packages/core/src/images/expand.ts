import { normalizeEntityName } from "../entity.js";
import type { CharacterOutfit } from "./outfits.js";
import type { CharacterVisualProfile } from "./types.js";
import type {
	VisualDressState,
	VisualSlotPart,
	VisualSlotView,
} from "./vocabulary.js";

export const VISUAL_EXPAND_STATES = ["clothed", "bare", "hidden"] as const;

/** 画面里的着装状态；`hidden` 表示这个部位不在画面里。 */
export type VisualExpandState = (typeof VISUAL_EXPAND_STATES)[number];

export function isVisualExpandState(
	value: unknown,
): value is VisualExpandState {
	return (
		typeof value === "string" &&
		(VISUAL_EXPAND_STATES as readonly string[]).includes(value)
	);
}

export interface ExpandVisualProfileInput {
	readonly profile: CharacterVisualProfile;
	/** 选中的服装；为空表示不拼服装标签。 */
	readonly outfit?: CharacterOutfit | null;
	readonly view: VisualSlotView;
	readonly visiblePart: VisualSlotPart;
	readonly state: VisualExpandState;
}

export interface ExpandedVisualProfile {
	readonly character: string;
	readonly tags: readonly string[];
	readonly outfitId: string | null;
	/** 所选分格为空，用了基础外貌 `base`。 */
	readonly usedBase: boolean;
}

const OUTFIT_HIDDEN_BY_PART: Readonly<
	Record<VisualSlotPart, { readonly upper: boolean; readonly full: boolean }>
> = {
	face: { upper: true, full: true },
	upper: { upper: false, full: true },
	full: { upper: false, full: false },
};

/**
 * 按视角、可见部位与着装状态取对应的外貌格；格为空时回退到 base。
 * 着装状态下再按上身 / 全身在画面里可见或隐藏拼入服装标签。
 * 纯函数：不读数据库，不改输入。
 */
export function expandVisualProfile(
	input: ExpandVisualProfileInput,
): ExpandedVisualProfile {
	const { profile, outfit = null, view, visiblePart, state } = input;
	if (!isVisualExpandState(state)) {
		throw new Error("视觉档案展开的着装状态必须是 clothed、bare 或 hidden");
	}
	if (
		outfit !== null &&
		normalizeEntityName(outfit.character) !==
			normalizeEntityName(profile.character)
	) {
		throw new Error(
			`服装 ${outfit.name} 属于 ${outfit.character}，不能用在 ${profile.character} 上`,
		);
	}
	const tags: string[] = [];
	const seen = new Set<string>();
	const add = (value: string): void => {
		const tag = value.trim();
		if (tag.length === 0 || seen.has(tag)) return;
		seen.add(tag);
		tags.push(tag);
	};
	let usedBase = false;
	if (state !== "hidden") {
		const cell = profile.slots[visiblePart][view][state as VisualDressState];
		if (cell.length > 0) {
			for (const tag of cell) add(tag);
		} else {
			usedBase = true;
			for (const tag of profile.base) add(tag);
		}
	}
	if (outfit !== null && state === "clothed") {
		const hidden = OUTFIT_HIDDEN_BY_PART[visiblePart];
		for (const tag of hidden.upper ? outfit.upperHidden : outfit.upperVisible) {
			add(tag);
		}
		for (const tag of hidden.full ? outfit.fullHidden : outfit.fullVisible) {
			add(tag);
		}
	}
	return {
		character: profile.character,
		tags,
		outfitId: outfit?.id ?? null,
		usedBase,
	};
}
