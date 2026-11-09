import {
	type BackgroundJobHandler,
	requireJobNodeId,
} from "../background/types.js";
import {
	type JsonObject,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputArray } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { TimelineNode } from "../timeline.js";
import {
	type LedgerChangeCardDiff,
	assertLedgerChangeCardDiff,
	ledgerChangeCardId,
	readBeforeEntry,
} from "./cards.js";
import { readLedger } from "./read.js";
import { findQuoteNode, normalizeUserWillText } from "./user-will.js";

export const MEMORY_REVISION_JOB_KIND = "memory_revision";

/** 识别修改要求时读取的最近玩家消息条数；默认 6。 */
export const MEMORY_REVISION_WINDOW_FLOORS = 6;

const DRAFT_FIELDS = ["text", "sourceQuote", "diffs"] as const;

export interface MemoryRevisionHandlerOptions {
	/** 读取的最近玩家消息条数；默认 6。 */
	readonly windowFloors?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

/** 模型识别出的一张变更卡草案；来源楼层由程序按引文定位。 */
export interface RevisionDraft {
	readonly text: string;
	readonly sourceQuote: string;
	readonly sourceNodeId: string;
	/** 尚未校验的修改，逐条校验后整卡接受或拒绝。 */
	readonly rawDiffs: readonly unknown[];
}

const SYSTEM_PROMPT = [
	"你是故事台账的修订记录员。阅读最近的玩家消息，找出玩家明确要求修改故事事实的句子，把每个要求整理成一张变更卡草案。",
	"- 只处理明确的修改要求：玩家指出要改哪条事实、改成什么。",
	"- 模糊的陈述、疑问、玩笑、角色台词与旁白都不生成草案。",
	"- 已经存在的用户意志与变更卡不要重复生成。",
	"- sourceQuote 必须逐字摘自表达该要求的玩家消息，不要改写。",
	"- text 用一句话概括玩家的修改要求。",
	'- diffs 至少一条；每条形如 {"path":["character","凛","location"],"op":"set","value":"屋顶"}，op 取 set 或 delete，delete 不带 value。',
	"命名空间与路径：",
	"- character.<人物 id>.<tier|identity|appearance|outfit|status|location>，tier 取 lead 或 minor",
	'- relation.<from>.<to>.<type|stage|turningPoint|affectionInner|affectionOuter|inertia>，好感取 "敌对"、"冷淡"、"平常"、"亲近"、"倾心"，inertia 是 0 到 1',
	"- item.<物品 id>.<holder|location|origin>；item.<物品 id>.log.<条目 id> 的值是 {text,nodeId,at}",
	"- scene.places.<地点 id>.<name|description|parent>；scene.current.<place|posture|atmosphere|participants>",
	"- time.current 的值是故事内时间",
	"- clue.<线索 id>.<text|status|openedAt|updatedAt>，status 取 open、progress、fulfilled",
	"- knowledge.<知情者>.<条目 id> 的值是 {factId,text}",
	"- userWill.<id> 的值是 {kind,text,sourceNodeId,createdAt}",
	"- 只输出一个 JSON 数组，不要解释、前后缀或代码块标记；每一项形如：",
	'[{"text":"把凛的所在地改成屋顶","sourceQuote":"凛现在应该在屋顶","diffs":[{"path":["character","凛","location"],"op":"set","value":"屋顶"}]}]',
	"- 没有可生成的修改时输出空数组 []。",
].join("\n");

/**
 * 解析模型返回的变更卡草案数组。`sourceQuote` 必须逐字出现在本次窗口的
 * 玩家楼层里，否则整次拒绝并指出条目序号；`diffs` 的校验留给逐卡处理，
 * 这样一张卡的非法值只拒绝这张卡。
 */
export function parseRevisionResponse(
	text: string,
	playerNodes: readonly TimelineNode[],
): RevisionDraft[] {
	const parsed = parseJsonOutputArray(text, "变更卡草案");
	return parsed.map((item, index) => {
		const label = `变更卡草案[${index}]`;
		const record = assertPlainObject(item, label);
		rejectUnknownKeys(record, DRAFT_FIELDS, label);
		const draftText = requireNonEmptyString(record.text, `${label}.text`);
		const sourceQuote = requireNonEmptyString(
			record.sourceQuote,
			`${label}.sourceQuote`,
		);
		if (!Array.isArray(record.diffs) || record.diffs.length === 0) {
			throw new Error(`${label}.diffs 必须是至少一条修改的数组`);
		}
		const sourceNode = findQuoteNode(playerNodes, sourceQuote);
		if (sourceNode === null) {
			throw new Error(
				`${label}.sourceQuote 不在本次窗口的玩家消息里：${sourceQuote}`,
			);
		}
		return {
			text: draftText,
			sourceQuote,
			sourceNodeId: sourceNode.id,
			rawDiffs: record.diffs,
		};
	});
}

/**
 * 自然语言修订的后台任务：读当前路径上最近的玩家消息，把明确的修改要求
 * 变成待定变更卡。一张卡里只要有非法修改就整卡拒绝，原因记在卡片上，
 * 其余卡片照常入库；同一份草案重复执行不会新增卡片。
 */
export function createMemoryRevisionHandler(
	options: MemoryRevisionHandlerOptions = {},
): BackgroundJobHandler {
	const windowFloors = options.windowFloors ?? MEMORY_REVISION_WINDOW_FLOORS;
	if (!Number.isInteger(windowFloors) || windowFloors < 1) {
		throw new Error("修订草案的玩家消息窗口必须是正整数");
	}
	return async ({ store, client, job, signal }) => {
		const nodeId = requireJobNodeId(job);
		const path = store.getPathToNode(nodeId);
		const players = path
			.filter((node) => node.role === "user" && node.raw.trim().length > 0)
			.slice(-windowFloors);
		if (players.length === 0) return;
		const snapshot = store.getStateSnapshot(nodeId).state;
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content: buildUserContent(
					store,
					job.storyId,
					nodeId,
					snapshot,
					players,
				),
			},
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
		const drafts = parseRevisionResponse(result.text, players);
		applyRevisionDrafts(store, job.storyId, nodeId, drafts, snapshot);
	};
}

/**
 * 把已经解析、并且引文已经定位到玩家楼层的变更卡草案写进卡片表：一张卡
 * 只要有非法修改就整卡以 rejected 入库并记录原因，其余卡片照常写入；
 * 稳定 id 已经存在的卡片跳过。返回值是实际新增的卡片数。
 */
export function applyRevisionDrafts(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	drafts: readonly RevisionDraft[],
	snapshot: JsonObject,
): number {
	const createdAt = new Date().toISOString();
	let inserted = 0;
	for (const draft of drafts) {
		const id = ledgerChangeCardId([
			MEMORY_REVISION_JOB_KIND,
			normalizeUserWillText(draft.text),
			JSON.stringify(draft.rawDiffs),
		]);
		if (store.getLedgerChangeCard(id) !== null) continue;
		const accepted: LedgerChangeCardDiff[] = [];
		let rejection: string | null = null;
		for (const [index, raw] of draft.rawDiffs.entries()) {
			try {
				accepted.push(
					assertLedgerChangeCardDiff(
						raw,
						`变更卡 ${draft.text} 的 diffs[${index}]`,
					),
				);
			} catch (error) {
				rejection = error instanceof Error ? error.message : String(error);
				break;
			}
		}
		if (rejection !== null) {
			store.insertLedgerChangeCard({
				id,
				storyId,
				source: "player",
				sourceNodeId: draft.sourceNodeId,
				text: draft.text,
				diffs: [],
				before: [],
				status: "rejected",
				rejectionReason: rejection,
				createdAt,
				decidedAt: createdAt,
			});
			inserted += 1;
			continue;
		}
		store.insertLedgerChangeCard({
			id,
			storyId,
			source: "player",
			sourceNodeId: draft.sourceNodeId,
			text: draft.text,
			diffs: accepted,
			before: accepted.map((diff) => readBeforeEntry(snapshot, diff.path)),
			status: "pending",
			createdAt,
			decidedAt: null,
		});
		inserted += 1;
	}
	return inserted;
}

function buildUserContent(
	store: StoryStore,
	storyId: string,
	nodeId: string,
	snapshot: JsonObject,
	players: readonly TimelineNode[],
): string {
	const lines = ["当前台账快照（截至本楼层）：", JSON.stringify(snapshot), ""];
	const wills = readExistingWillTexts(store, nodeId);
	lines.push("已有的用户意志（不要重复）：");
	if (wills.length === 0) lines.push("无。");
	for (const text of wills) lines.push(`- ${text}`);
	lines.push("", "已有的变更卡（不要重复）：");
	const cards = store
		.listLedgerChangeCards(storyId)
		.filter((card) => card.status === "pending" || card.status === "approved");
	if (cards.length === 0) lines.push("无。");
	for (const card of cards) lines.push(`- ${card.text}`);
	lines.push("", "最近的玩家消息：");
	for (const node of players) {
		lines.push(`<玩家消息 id="${node.id}">`);
		lines.push(node.raw);
		lines.push("</玩家消息>");
	}
	return lines.join("\n");
}

function readExistingWillTexts(store: StoryStore, nodeId: string): string[] {
	const value = readLedger(store, nodeId, ["userWill"]);
	if (value === undefined) return [];
	if (!isJsonObject(value)) {
		throw new Error("台账路径 userWill 必须是对象");
	}
	const texts: string[] = [];
	for (const entry of Object.values(value)) {
		if (isJsonObject(entry) && typeof entry.text === "string") {
			texts.push(entry.text);
		}
	}
	return texts;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}
