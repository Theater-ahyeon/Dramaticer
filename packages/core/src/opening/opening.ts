import { createHash } from "node:crypto";
import type { BackgroundJobHandler } from "../background/types.js";
import { DEFAULT_CONTEXT_TEMPLATE_ID } from "../context/template.js";
import { normalizeEntityName } from "../entity.js";
import {
	type JsonObject,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { LoreEntry } from "../memory/lore.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";

export const OPENING_JOB_KIND = "opening";

/** 三条可选开场方向的条数。 */
export const OPENING_DIRECTION_COUNT = 3;

export interface OpeningParticipant {
	readonly name: string;
	readonly wants: string;
}

/** 开局包的正文形状：开场地点与时间、在场人物、第一个冲突与三条方向。 */
export interface OpeningPackPayload {
	readonly place: string;
	readonly time: string;
	readonly participants: readonly OpeningParticipant[];
	readonly conflict: string;
	readonly directions: readonly string[];
}

const PAYLOAD_FIELDS = [
	"place",
	"time",
	"participants",
	"conflict",
	"directions",
] as const;

const PARTICIPANT_FIELDS = ["name", "wants"] as const;

/** 名称至少两个字符才按“正文里出现过”判定，单字名在任何句子里都会偶然命中。 */
const MIN_INLINE_NAME_CHARS = 2;

/** 校验开局包在场人物的依据：角色卡名、实体名称与别名，以及角色卡与常驻世界书正文。 */
export interface OpeningKnownNames {
	/** 规范化后的名称与别名。 */
	readonly names: ReadonlySet<string>;
	/** 角色卡正文与常驻世界书正文，里面写到的其他人物也算已知。 */
	readonly sourceText: string;
}

/** 人物名来自实体表，或者出现在角色卡与常驻世界书正文里，就算已知。 */
export function isKnownOpeningName(
	known: OpeningKnownNames,
	name: string,
): boolean {
	const normalized = normalizeEntityName(name);
	if (normalized.length === 0) return false;
	if (known.names.has(normalized)) return true;
	if ([...normalized].length < MIN_INLINE_NAME_CHARS) return false;
	return normalizeEntityName(known.sourceText).includes(normalized);
}

export interface OpeningHandlerOptions {
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

const SYSTEM_PROMPT = [
	"你是故事的开局导演。根据角色卡、世界书常驻设定与玩家的开场白，设计这一场故事的开场。",
	"- place：开场地点，一句话。",
	"- time：开场的故事内时间，一句话。",
	'- participants：在场人物数组，每项是 {"name": 人物名, "wants": 这个人物此刻最想要什么}。人物名必须是角色卡或世界书里出现过的名字，包括角色卡描述里提到的其他人物，不要临时编造。',
	"- conflict：第一个可以行动的冲突，一句话，具体到人和事。",
	"- directions：三条可选的开场方向，每条一句话，彼此要有明显区别。",
	"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如：",
	'{"place":"…","time":"…","participants":[{"name":"…","wants":"…"}],"conflict":"…","directions":["…","…","…"]}',
].join("\n");

/** 校验模型或存储给出的开局包；任何字段不合格都整包拒绝。 */
export function validateOpeningPackPayload(
	value: unknown,
	knownNames: OpeningKnownNames,
	label = "开局包",
): OpeningPackPayload {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, PAYLOAD_FIELDS, label);
	const place = requireText(record.place, `${label}.place`);
	const time = requireText(record.time, `${label}.time`);
	const conflict = requireText(record.conflict, `${label}.conflict`);
	if (!Array.isArray(record.participants) || record.participants.length === 0) {
		throw new Error(`${label}.participants 必须是至少一项的数组`);
	}
	const participants: OpeningParticipant[] = record.participants.map(
		(item, index) => {
			const entryLabel = `${label}.participants[${index}]`;
			const fields = assertPlainObject(item, entryLabel);
			rejectUnknownKeys(fields, PARTICIPANT_FIELDS, entryLabel);
			const name = requireText(fields.name, `${entryLabel}.name`);
			if (!isKnownOpeningName(knownNames, name)) {
				throw new Error(
					`${entryLabel}.name 不是角色卡或世界书里的人物：${name}`,
				);
			}
			return {
				name,
				wants: requireText(fields.wants, `${entryLabel}.wants`),
			};
		},
	);
	if (
		!Array.isArray(record.directions) ||
		record.directions.length !== OPENING_DIRECTION_COUNT
	) {
		throw new Error(
			`${label}.directions 必须是 ${OPENING_DIRECTION_COUNT} 条字符串`,
		);
	}
	const directions = record.directions.map((item, index) =>
		requireText(item, `${label}.directions[${index}]`),
	);
	return { place, time, participants, conflict, directions };
}

/** 解析模型返回的开局包；未知字段、缺字段与未知人物都整包拒绝。 */
export function parseOpeningPackResponse(
	text: string,
	knownNames: OpeningKnownNames,
): OpeningPackPayload {
	return validateOpeningPackPayload(
		parseJsonOutputObject(text, "开局包"),
		knownNames,
	);
}

export interface OpeningInput {
	/** 输入摘要：角色卡、常驻世界书、模板与首条玩家消息变化时变化。 */
	readonly hash: string;
	readonly cardName: string | null;
	readonly characterPrompt: string;
	readonly loreEntries: readonly LoreEntry[];
	readonly openingNode: TimelineNode | null;
	readonly knownNames: OpeningKnownNames;
}

/**
 * 收集生成开局包需要的输入。故事还没有角色卡与常驻世界书时返回 null，
 * 因为没有可用素材；玩家开场白只作补充，不单独触发生成。
 */
export function collectOpeningInput(
	store: StoryStore,
	storyId: string,
): OpeningInput | null {
	const settings = store.getStorySettings(storyId);
	const characterPrompt = settings.characterPrompt ?? "";
	const loreEntries = store
		.listLoreEntries(storyId)
		.filter((entry) => entry.constant);
	if (characterPrompt.trim().length === 0 && loreEntries.length === 0) {
		return null;
	}
	const templateId = settings.templateId ?? DEFAULT_CONTEXT_TEMPLATE_ID;
	const template =
		settings.templateId === null
			? null
			: store.getContextTemplate(settings.templateId);
	if (settings.templateId !== null && template === null) {
		throw new Error(`上下文模板不存在：${settings.templateId}`);
	}
	const path = store.getPathToHead(storyId);
	const openingNode =
		path.find((node) => node.role === "user" && node.raw.trim().length > 0) ??
		null;
	const knownNames = collectKnownNames(
		store,
		storyId,
		settings.cardName,
		characterPrompt,
		loreEntries,
	);
	const hash = createHash("sha256")
		.update(
			JSON.stringify({
				cardName: settings.cardName,
				characterPrompt,
				templateId,
				template: template?.template ?? null,
				lore: loreEntries.map((entry) => [entry.id, entry.name, entry.content]),
				opening: openingNode?.raw ?? null,
			}),
		)
		.digest("hex");
	return {
		hash,
		cardName: settings.cardName,
		characterPrompt,
		loreEntries,
		openingNode,
		knownNames,
	};
}

/**
 * 角色卡名、角色实体的名称与别名，再加上角色卡与常驻世界书正文，
 * 用来校验开局包里的在场人物。
 */
function collectKnownNames(
	store: StoryStore,
	storyId: string,
	cardName: string | null,
	characterPrompt: string,
	loreEntries: readonly LoreEntry[],
): OpeningKnownNames {
	const names = new Set<string>();
	if (cardName !== null) {
		names.add(normalizeEntityName(cardName));
	}
	for (const entity of store.listEntities(storyId, { kind: "character" })) {
		names.add(normalizeEntityName(entity.name));
		for (const alias of entity.aliases) {
			names.add(normalizeEntityName(alias));
		}
	}
	const sourceText = [
		characterPrompt,
		...loreEntries.map((entry) => entry.content),
	].join("\n");
	return { names, sourceText };
}

/**
 * 导演读开局包；没有时返回 null。存下来的包用当前的角色卡、实体与常驻世界书校验，
 * 卡里改掉人物的名字会让读取失败，需要重新生成开局包。
 */
export function readOpeningPack(
	store: StoryStore,
	storyId: string,
): OpeningPackPayload | null {
	const record = store.getOpeningPack(storyId);
	if (record === null) return null;
	const settings = store.getStorySettings(storyId);
	const loreEntries = store
		.listLoreEntries(storyId)
		.filter((entry) => entry.constant);
	return validateOpeningPackPayload(
		record.payload,
		collectKnownNames(
			store,
			storyId,
			settings.cardName,
			settings.characterPrompt ?? "",
			loreEntries,
		),
		`故事 ${storyId} 的开局包`,
	);
}

/**
 * 入队条件为 story 的判定：素材存在，并且还没有开局包或输入已经变化。
 * 同一输入重复运行时不再建任务。
 */
export function openingPackNeedsRun(
	store: StoryStore,
	storyId: string,
): boolean {
	const input = collectOpeningInput(store, storyId);
	if (input === null) return false;
	const pack = store.getOpeningPack(storyId);
	return pack === null || pack.inputHash !== input.hash;
}

/**
 * 开局包的后台任务：输入是角色卡、世界书常驻条目与首条玩家消息；
 * 模型输出严格 JSON，整包校验通过后按故事覆盖同一行。开局包不写台账。
 */
export function createOpeningHandler(
	options: OpeningHandlerOptions = {},
): BackgroundJobHandler {
	return async ({ store, client, job, signal }) => {
		const input = collectOpeningInput(store, job.storyId);
		if (input === null) return;
		const existing = store.getOpeningPack(job.storyId);
		if (existing !== null && existing.inputHash === input.hash) return;
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildOpeningUserContent(input) },
		];
		const result = await client.complete(
			{
				messages,
				model: options.model,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		const payload = parseOpeningPackResponse(result.text, input.knownNames);
		store.saveOpeningPack({
			storyId: job.storyId,
			payload: payload as unknown as JsonObject,
			inputHash: input.hash,
			sourceNodeId: input.openingNode?.id ?? null,
		});
	};
}

/** 把角色卡、常驻世界书与玩家开场白拼成生成开局内容共用的用户消息。 */
export function buildOpeningUserContent(input: OpeningInput): string {
	const lines: string[] = [];
	lines.push("角色卡：");
	if (input.cardName !== null) lines.push(`名称：${input.cardName}`);
	lines.push(
		input.characterPrompt.trim().length === 0
			? "（没有正文）"
			: input.characterPrompt,
	);
	if (input.loreEntries.length === 0) {
		lines.push("", "世界书常驻条目：无。");
	} else {
		lines.push("", "世界书常驻条目：");
		for (const entry of input.loreEntries) {
			lines.push(`<条目 name="${entry.name}">`);
			lines.push(entry.content);
			lines.push("</条目>");
		}
	}
	lines.push("", "玩家的开场白：");
	lines.push(
		input.openingNode === null
			? "（还没有开场白，按角色卡设计开场）"
			: input.openingNode.raw,
	);
	return lines.join("\n");
}

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}
