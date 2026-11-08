import { createHash } from "node:crypto";
import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import { assertPlainObject, isJsonObject, rejectUnknownKeys } from "../json.js";
import type { LlmMessage } from "../llm/types.js";
import { parseJsonOutputArray } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff, TimelineNode } from "../timeline.js";
import { readLedger } from "./read.js";
import {
	USER_WILL_KINDS,
	type UserWillKind,
	validateLedgerDiff,
} from "./schema.js";

export const USER_WILL_JOB_KIND = "user_will";

/** 识别用户意志时读取的最近玩家消息条数；默认 6。 */
export const USER_WILL_WINDOW_FLOORS = 6;

/** `userWill` 台账路径的第一段。 */
const USER_WILL_NAMESPACE = "userWill";

const CAPTURED_FIELDS = ["kind", "text", "sourceQuote"] as const;

/** 正文两端的标点与空白；用于规范化与去重。 */
const EDGE_PUNCTUATION =
	/^[\s!"'“”‘’《》〈〉()（）[\]{}【】。，、！？；：…—\-_,.;:?·~～]+|[\s!"'“”‘’《》〈〉()（）[\]{}【】。，、！？；：…—\-_,.;:?·~～]+$/gu;

export interface UserWillHandlerOptions {
	/** 读取的最近玩家消息条数；默认 6。 */
	readonly windowFloors?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

/** 模型识别出的一条用户意志；`sourceNodeId` 由程序按引文定位。 */
export interface CapturedUserWill {
	readonly kind: UserWillKind;
	readonly text: string;
	readonly sourceQuote: string;
	readonly sourceNodeId: string;
}

const SYSTEM_PROMPT = [
	"你是故事的用户意志记录员。阅读最近的玩家消息，找出玩家明确表达的偏好、底线与纠正。",
	"- kind 取 preference（偏好）、boundary（底线）、correction（纠正）。",
	"- 只记录玩家自己说出的、跨楼层仍然有效的要求；不要记录这一轮的具体行动或对当前场景的描述。",
	"- 模糊的陈述、疑问、玩笑、角色台词与旁白都不记录。",
	"- 已经记录过的内容不要重复记录；同一层意思换一种说法出现时也只记录一条。",
	"- sourceQuote 必须逐字摘自玩家消息里表达这层意思的原句，不要改写。",
	"- 只输出一个 JSON 数组，不要解释、前后缀或代码块标记；每一项形如：",
	'[{"kind":"preference","text":"剧情保持轻松","sourceQuote":"我想看轻松一点的剧情"}]',
	"- 没有可记录的内容时输出空数组 []。",
].join("\n");

/**
 * 把用户意志正文规范化成去重用的形式：全角转半角、合并空白、去掉两端标点，
 * 英文字母统一小写。规范化后为空的正文没有可比较的形式，直接拒绝。
 */
export function normalizeUserWillText(text: string): string {
	if (typeof text !== "string") {
		throw new Error("用户意志正文必须是字符串");
	}
	const normalized = text
		.normalize("NFKC")
		.replace(/\s+/gu, " ")
		.trim()
		.replace(EDGE_PUNCTUATION, "")
		.trim()
		.toLowerCase();
	if (normalized.length === 0) {
		throw new Error("用户意志正文在规范化后为空");
	}
	return normalized;
}

/** 用户意志的稳定 id：规范化正文的摘要，同样的正文永远得到同一个路径。 */
export function userWillStableId(text: string): string {
	const normalized = normalizeUserWillText(text);
	const digest = createHash("sha256").update(normalized).digest("hex");
	return `will-${digest.slice(0, 16)}`;
}

/**
 * 解析模型返回的用户意志数组。`sourceQuote` 必须逐字出现在本次窗口的玩家
 * 楼层里；角色台词、旁白或窗口外的内容一律整条拒绝并指出位置。
 */
export function parseUserWillResponse(
	text: string,
	playerNodes: readonly TimelineNode[],
): CapturedUserWill[] {
	const parsed = parseJsonOutputArray(text, "用户意志抽取结果");
	return parsed.map((item, index) => {
		const label = `用户意志[${index}]`;
		const record = assertPlainObject(item, label);
		rejectUnknownKeys(record, CAPTURED_FIELDS, label);
		const kind = record.kind;
		if (
			typeof kind !== "string" ||
			!(USER_WILL_KINDS as readonly string[]).includes(kind)
		) {
			throw new Error(`${label}.kind 只能是 ${USER_WILL_KINDS.join("、")}`);
		}
		const textValue = requireNonEmptyString(record.text, `${label}.text`);
		const sourceQuote = requireNonEmptyString(
			record.sourceQuote,
			`${label}.sourceQuote`,
		);
		const sourceNode = findQuoteNode(playerNodes, sourceQuote);
		if (sourceNode === null) {
			throw new Error(
				`${label}.sourceQuote 不在本次窗口的玩家消息里：${sourceQuote}`,
			);
		}
		return {
			kind: kind as UserWillKind,
			text: textValue,
			sourceQuote,
			sourceNodeId: sourceNode.id,
		};
	});
}

/**
 * 用户意志的后台任务：读当前路径上最近若干条玩家消息，识别明确表达的偏好、
 * 底线与纠正，写入 `userWill.<稳定 id>`。同一正文在路径上已经存在时跳过，
 * 因此重复表达与重复执行都不新增条目。
 */
export function createUserWillHandler(
	options: UserWillHandlerOptions = {},
): BackgroundJobHandler {
	const windowFloors = options.windowFloors ?? USER_WILL_WINDOW_FLOORS;
	if (!Number.isInteger(windowFloors) || windowFloors < 1) {
		throw new Error("用户意志的玩家消息窗口必须是正整数");
	}
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		const path = store.getPathToNode(nodeId);
		const players = path
			.filter((node) => node.role === "user" && node.raw.trim().length > 0)
			.slice(-windowFloors);
		if (players.length === 0) return;
		const existing = readExistingWills(store, nodeId);
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildUserContent(existing.texts, players) },
		];
		const result = await client.complete({
			messages,
			model: options.model,
			temperature: 0,
			signal,
		});
		const captured = parseUserWillResponse(result.text, players);
		applyCapturedUserWills(store, job.storyId, nodeId, captured);
	};
}

/**
 * 把已经解析、并且引文已经定位到玩家楼层的用户意志写进台账：同一稳定 id
 * 在路径上已经存在时跳过，返回值是实际新增的条数。
 */
export function applyCapturedUserWills(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	captured: readonly CapturedUserWill[],
): number {
	const existing = readExistingWills(store, nodeId);
	const createdAt = new Date().toISOString();
	const seen = new Set(existing.ids);
	const diffs: NewStateDiff[] = [];
	for (const entry of captured) {
		const id = userWillStableId(entry.text);
		if (seen.has(id)) continue;
		seen.add(id);
		const path = [USER_WILL_NAMESPACE, id];
		const value = {
			kind: entry.kind,
			text: entry.text,
			sourceNodeId: entry.sourceNodeId,
			createdAt,
		};
		validateLedgerDiff({ path, op: "set", value, source: "settler" });
		diffs.push({
			storyId,
			nodeId,
			path,
			op: "set",
			value,
			source: "settler",
		});
	}
	if (diffs.length > 0) store.appendStateDiffs(diffs);
	return diffs.length;
}

export interface ExistingWills {
	readonly ids: readonly string[];
	readonly texts: readonly string[];
}

export function readExistingWills(
	store: StoryStore,
	nodeId: string,
): ExistingWills {
	const value = readLedger(store, nodeId, [USER_WILL_NAMESPACE]);
	if (value === undefined) return { ids: [], texts: [] };
	if (!isJsonObject(value)) {
		throw new Error(`台账路径 ${USER_WILL_NAMESPACE} 必须是对象`);
	}
	const ids: string[] = [];
	const texts: string[] = [];
	for (const [id, entry] of Object.entries(value)) {
		ids.push(id);
		if (isJsonObject(entry) && typeof entry.text === "string") {
			texts.push(entry.text);
		}
	}
	return { ids, texts };
}

function buildUserContent(
	existing: readonly string[],
	players: readonly TimelineNode[],
): string {
	const lines: string[] = [];
	if (existing.length === 0) {
		lines.push("已有的用户意志：无。");
	} else {
		lines.push("已有的用户意志（不要重复记录）：");
		for (const text of existing) lines.push(`- ${text}`);
	}
	lines.push("", "最近的玩家消息：");
	for (const node of players) {
		lines.push(`<玩家消息 id="${node.id}">`);
		lines.push(node.raw);
		lines.push("</玩家消息>");
	}
	return lines.join("\n");
}

/** 从新到旧找第一条包含引文的玩家消息；找不到返回 null。 */
export function findQuoteNode(
	playerNodes: readonly TimelineNode[],
	quote: string,
): TimelineNode | null {
	for (let index = playerNodes.length - 1; index >= 0; index -= 1) {
		const node = playerNodes[index];
		if (node?.raw.includes(quote)) return node;
	}
	return null;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}
