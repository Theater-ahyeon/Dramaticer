import { type JsonValue, isJsonObject } from "../json.js";
import type { StoryStore } from "../store/story-store.js";
import { type WritingEntry, readWritingEntries } from "./writing-entries.js";

/**
 * 写作选项：玩家用几个明确的选项定下文风、人称、长度、节奏、尺度、思考与
 * 是否替自己行动。每一项的取值是固定的几个词，进入上下文时换成一句要求。
 */
export const WRITING_DIAL_CHOICES = {
	style: ["card", "cold", "rich", "spoken"],
	person: ["second", "first", "third"],
	length: ["short", "medium", "long"],
	pace: ["slow", "medium", "fast"],
	rating: ["card", "restrained"],
	thinking: ["off", "low", "high"],
} as const;

/** 故事级配置里记「玩家选了规划写法」的键；存储层的回合模式仍是快速或深度。 */
export const WRITING_MODE_KEY = "writingMode";

export type WritingDialId = keyof typeof WRITING_DIAL_CHOICES;

export type WritingDials = {
	readonly [K in WritingDialId]: (typeof WRITING_DIAL_CHOICES)[K][number];
} & {
	/** 关掉后，角色不会替玩家说话或做决定。 */
	readonly actForMe: boolean;
	/** 导入预设里对应不上选项的条目，作为文风包整体开关。 */
	readonly stylePack: boolean;
};

export const DEFAULT_WRITING_DIALS: WritingDials = {
	style: "card",
	person: "second",
	length: "medium",
	pace: "medium",
	rating: "card",
	thinking: "low",
	actForMe: false,
	stylePack: true,
};

export const WRITING_DIAL_LABELS: Readonly<
	Record<
		WritingDialId,
		{ title: string; hint: string; choices: readonly string[] }
	>
> = {
	style: {
		title: "文风",
		hint: "跟着卡 / 冷叙述 / 细腻 / 口语",
		choices: ["跟着卡", "冷叙述", "细腻", "口语"],
	},
	person: {
		title: "人称",
		hint: "叙述时怎么称呼你",
		choices: ["你", "我", "他"],
	},
	length: { title: "长度", hint: "每一楼写多少", choices: ["短", "中", "长"] },
	pace: {
		title: "节奏",
		hint: "没有你指示时走多快",
		choices: ["慢", "适中", "快"],
	},
	rating: {
		title: "尺度",
		hint: "跟着卡的设定，或者收一点",
		choices: ["跟着卡", "收敛"],
	},
	thinking: {
		title: "思考",
		hint: "写之前想多久",
		choices: ["不想", "想一下", "多想"],
	},
};

const DIAL_SENTENCES: {
	readonly [K in WritingDialId]: Readonly<Record<string, string>>;
} = {
	style: {
		cold: "文风：冷叙述。少形容词，多写动作与物件，不替人物解释心情。",
		rich: "文风：细腻。把感官细节与人物的细微反应写出来。",
		spoken: "文风：口语。句子短，像当面讲故事。",
	},
	person: {
		first: "人称：用第一人称「我」叙述玩家角色。",
		third: "人称：用第三人称叙述玩家角色，称呼其名字或「他/她」。",
	},
	length: {
		short: "长度：这一楼写短，两三段以内。",
		long: "长度：这一楼写长，把场面完整展开。",
	},
	pace: {
		slow: "节奏：慢。停在眼前的场面里，不急着推进。",
		fast: "节奏：快。少铺垫，每一楼都让局面有变化。",
	},
	rating: {
		restrained: "尺度：收敛。亲密与暴力的内容点到为止，不做露骨描写。",
	},
	thinking: {
		off: "思考：不用在正文前推理，直接写眼前的场面。",
		high: "思考：动笔前多想一步，理清人物的动机与这一楼的因果。",
	},
};

const KV_OVERRIDES = "writing.overrides";
const KV_RECOMMENDED = "writing.recommended";
const KV_PRESET = "writing.preset";

/** 导入预设后的对应结果：多少条对应到了选项，多少条进了文风包。 */
export interface WritingPresetMapping {
	readonly name: string;
	readonly total: number;
	readonly mapped: number;
	readonly packCount: number;
	/** 文风包的正文：对应不上的条目按原顺序拼接。 */
	readonly packText: string;
}

export interface WritingView {
	readonly dials: WritingDials;
	/** 卡的推荐；卡没有带时为 null。 */
	readonly recommended: Partial<WritingDials> | null;
	/** 玩家叠在推荐之上的调整。 */
	readonly overrides: Partial<WritingDials>;
	readonly preset: Omit<WritingPresetMapping, "packText"> | null;
	/** 写作条目：按位置与角色放进上下文的写作指令（导入预设或玩家自建）。 */
	readonly entries: readonly WritingEntry[];
}

/** 只留下合法的选项值；来历不明的字段直接丢掉。 */
export function sanitizeWritingDials(value: unknown): Partial<WritingDials> {
	if (!isJsonObject(value)) return {};
	const result: Record<string, unknown> = {};
	for (const id of Object.keys(WRITING_DIAL_CHOICES) as WritingDialId[]) {
		const choice = value[id];
		if (
			typeof choice === "string" &&
			(WRITING_DIAL_CHOICES[id] as readonly string[]).includes(choice)
		) {
			result[id] = choice;
		}
	}
	if (typeof value.actForMe === "boolean") result.actForMe = value.actForMe;
	if (typeof value.stylePack === "boolean") result.stylePack = value.stylePack;
	return result as Partial<WritingDials>;
}

function readPreset(
	store: StoryStore,
	storyId: string,
): WritingPresetMapping | null {
	const value = store.getStoryValue(storyId, KV_PRESET);
	if (!isJsonObject(value) || typeof value.packText !== "string") return null;
	return {
		name: typeof value.name === "string" ? value.name : "",
		total: typeof value.total === "number" ? value.total : 0,
		mapped: typeof value.mapped === "number" ? value.mapped : 0,
		packCount: typeof value.packCount === "number" ? value.packCount : 0,
		packText: value.packText,
	};
}

/** 生效的写作选项：默认值、卡的推荐、玩家的调整，后面的盖住前面的。 */
export function readWritingView(
	store: StoryStore,
	storyId: string,
): WritingView {
	const recommendedRaw = store.getStoryValue(storyId, KV_RECOMMENDED);
	const recommended =
		recommendedRaw === null ? null : sanitizeWritingDials(recommendedRaw);
	const overrides = sanitizeWritingDials(
		store.getStoryValue(storyId, KV_OVERRIDES),
	);
	const preset = readPreset(store, storyId);
	return {
		dials: { ...DEFAULT_WRITING_DIALS, ...(recommended ?? {}), ...overrides },
		recommended,
		overrides,
		preset:
			preset === null
				? null
				: {
						name: preset.name,
						total: preset.total,
						mapped: preset.mapped,
						packCount: preset.packCount,
					},
		entries: readWritingEntries(store, storyId),
	};
}

/** 玩家调整几个选项；传 null 表示清掉全部调整，回到卡的推荐。 */
export function writeWritingOverrides(
	store: StoryStore,
	storyId: string,
	patch: unknown,
): WritingView {
	if (patch === null) {
		store.setStoryValue(storyId, KV_OVERRIDES, null);
		return readWritingView(store, storyId);
	}
	const next = {
		...sanitizeWritingDials(store.getStoryValue(storyId, KV_OVERRIDES)),
		...sanitizeWritingDials(patch),
	};
	store.setStoryValue(storyId, KV_OVERRIDES, next as unknown as JsonValue);
	return readWritingView(store, storyId);
}

/** 卡的推荐写作选项；载入卡时写一次，升级卡时更新。 */
export function saveRecommendedWriting(
	store: StoryStore,
	storyId: string,
	recommended: unknown,
): void {
	const clean = sanitizeWritingDials(recommended);
	store.setStoryValue(
		storyId,
		KV_RECOMMENDED,
		Object.keys(clean).length === 0 ? null : (clean as unknown as JsonValue),
	);
}

/** 保存一次预设导入的对应结果；预设里对应到选项的部分同时成为玩家的调整。 */
export function saveWritingPreset(
	store: StoryStore,
	storyId: string,
	mapping: WritingPresetMapping,
	dials: Partial<WritingDials>,
): WritingView {
	store.setStoryValue(storyId, KV_PRESET, mapping as unknown as JsonValue);
	return writeWritingOverrides(store, storyId, dials);
}

/**
 * 把写作选项换成紧贴生成位置的一段要求。取默认值的选项不产生文字；
 * 「替我行动」关闭时固定附一条不替玩家行动的要求。全部取默认值、
 * 「替我行动」打开且没有文风包时返回 null。
 */
export function formatWritingDials(
	store: StoryStore,
	storyId: string,
): string | null {
	const view = readWritingView(store, storyId);
	const lines: string[] = [];
	for (const id of Object.keys(DIAL_SENTENCES) as WritingDialId[]) {
		const sentence = DIAL_SENTENCES[id][view.dials[id]];
		if (sentence !== undefined) lines.push(sentence);
	}
	if (!view.dials.actForMe) {
		lines.push(
			"不要替玩家角色说话、行动或做决定；写到需要玩家回应的地方就停。",
		);
	}
	// 有写作条目时，预设里对应不上的内容已经按条目各自的位置放进上下文，不再拼成文风包。
	const preset =
		view.dials.stylePack && readWritingEntries(store, storyId).length === 0
			? readPreset(store, storyId)
			: null;
	if (preset !== null && preset.packText.trim().length > 0) {
		lines.push(`文风包（${preset.name}）：\n${preset.packText}`);
	}
	if (lines.length === 0) return null;
	return `【写作要求】\n${lines.join("\n")}`;
}
