import type { BackgroundJobHandler } from "../background/types.js";
import {
	type JsonObject,
	assertPlainObject,
	rejectUnknownKeys,
} from "../json.js";
import type { LlmMessage } from "../llm/types.js";
import { parseJsonOutputArray } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import type { NewStateDiff, StoryTime } from "../timeline.js";
import {
	CLUE_STATUSES,
	type LedgerSource,
	assertLedgerConfidence,
	isLedgerNamespace,
	validateLedgerDiff,
} from "./schema.js";
import type { LedgerRepair } from "./settlement.js";

export const SETTLE_JOB_KIND = "settle";
export const SETTLE_WINDOW_FLOORS = 4;

export interface SettleHandlerOptions {
	/** 一次结算请求最多覆盖的楼层数；默认 4。 */
	readonly windowSize?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
}

/** 线索状态的常见写法到允许取值的映射；只用于改写，不改写就无法通过校验。 */
const CLUE_STATUS_ALIASES: Readonly<Record<string, string>> = {
	opened: "open",
	开启: "open",
	未兑现: "open",
	progressing: "progress",
	推进: "progress",
	进行中: "progress",
	closed: "closed",
	兑现: "fulfilled",
	已兑现: "fulfilled",
	完成: "fulfilled",
};

const DIFF_FIELDS = [
	"path",
	"op",
	"value",
	"reason",
	"confidence",
	"storyTime",
];

const SYSTEM_PROMPT = [
	"你是故事台账的结算器。阅读结算窗口里的楼层正文与当前台账快照，为每个楼层补齐正文已经确立、但楼层自己没有写入的台账事实。",
	"只输出一个 JSON 数组，不要输出解释、前后缀或代码块标记。每一项形如：",
	'{"nodeId":"楼层 id","diffs":[{"path":["clue","c1","status"],"op":"set","value":"open","confidence":0.8,"reason":"一句话依据"}]}',
	"- nodeId 必须是窗口里出现过的楼层 id，每个楼层最多出现一次。",
	"- path 至少两段：第一段是命名空间，后续路径段按命名空间的结构书写。",
	"- op 只能是 set 或 delete；delete 不能带 value。",
	"- confidence 是 0 到 1 的数字，表示这条事实有多确定。",
	"- reason 可选，写一句话说明正文里的依据。",
	"- 楼层里已经写入的路径不要重复输出。",
	"- 不要写正文里没有依据的事实；没有需要补的楼层仍然输出一项，diffs 为空数组。",
	"命名空间与路径：",
	"- character.<人物 id>.<tier|identity|appearance|outfit|status|location>，tier 取 lead 或 minor",
	'- relation.<from>.<to>.<type|stage|turningPoint|affectionInner|affectionOuter|inertia>，好感取 "敌对"、"冷淡"、"平常"、"亲近"、"倾心"，inertia 是 0 到 1',
	"- item.<物品 id>.<holder|location|origin>；item.<物品 id>.log.<条目 id> 的值是 {text,nodeId,at}",
	"- scene.places.<地点 id>.<name|description|parent>；scene.current.<place|posture|atmosphere|participants>",
	"- time.current 的值是故事内时间",
	"- clue.<线索 id>.<text|status|openedAt|updatedAt>，status 取 open、progress、fulfilled",
	"- knowledge.<知情者>.<事实> 的值是事实文本",
	"- userWill.<id> 的值是 {kind,text,sourceNodeId,createdAt}",
	"- mvu.<原始变量路径> 表示导入的 MVU 变量",
].join("\n");

interface SettlerProposal {
	readonly diff: {
		readonly path: readonly string[];
		readonly op: "set" | "delete";
		readonly value: unknown;
		readonly storyTime: StoryTime | null;
		readonly confidence: number;
	};
	readonly reason: string | null;
}

interface SettledFloor {
	readonly nodeId: string;
	readonly diffs: readonly NewStateDiff[];
	/** 本楼层已有的不合格台账写入，写入前删除。 */
	readonly deleteIds: readonly number[];
	readonly repairs: readonly LedgerRepair[];
	readonly source: LedgerSource;
}

interface InvalidExistingDiff {
	readonly id: number;
	readonly path: readonly string[];
	readonly reason: string;
}

interface WindowFloor {
	readonly nodeId: string;
	readonly raw: string;
	/** 已通过校验的台账路径：本楼层已有写入，结算器跳过。 */
	readonly covered: readonly (readonly string[])[];
	readonly invalid: readonly InvalidExistingDiff[];
}

/** 生成台账结算的后台任务处理器。 */
export function createSettleHandler(
	options: SettleHandlerOptions = {},
): BackgroundJobHandler {
	const windowSize = options.windowSize ?? SETTLE_WINDOW_FLOORS;
	if (!Number.isInteger(windowSize) || windowSize < 1) {
		throw new Error("结算窗口的楼层数必须是正整数");
	}
	return async ({ store, client, job }) => {
		const nodeIds = store.listUnsettledSettledAssistantNodes(
			job.storyId,
			windowSize,
		);
		if (nodeIds.length === 0) return;
		const floors = nodeIds.map((nodeId) => readWindowFloor(store, nodeId));
		const snapshotNodeId = nodeIds[nodeIds.length - 1] as string;
		const snapshot = store.getStateSnapshot(snapshotNodeId).state;
		const messages: LlmMessage[] = [
			{ role: "system", content: SYSTEM_PROMPT },
			{ role: "user", content: buildUserContent(floors, snapshot) },
		];
		const result = await client.complete({
			messages,
			model: options.model,
			temperature: 0,
		});
		const proposals = parseSettleResponse(result.text, nodeIds);
		const plans = floors.map((floor) =>
			planFloor(floor, proposals.get(floor.nodeId) ?? [], job.storyId),
		);
		await store.runInTransaction(() => {
			for (const plan of plans) {
				if (plan.deleteIds.length > 0) {
					store.deleteStateDiffs(plan.nodeId, plan.deleteIds);
				}
				if (plan.diffs.length > 0) {
					store.appendStateDiffs(plan.diffs);
				}
				store.recordLedgerSettlement({
					nodeId: plan.nodeId,
					storyId: job.storyId,
					source: plan.source,
					addedCount: plan.diffs.length,
					repairs: plan.repairs,
				});
			}
		});
	};
}

function readWindowFloor(store: StoryStore, nodeId: string): WindowFloor {
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`结算窗口里的楼层不存在：${nodeId}`);
	}
	const covered: string[][] = [];
	const invalid: InvalidExistingDiff[] = [];
	for (const diff of store.getStateDiffs(nodeId)) {
		const namespace = diff.path[0];
		if (typeof namespace !== "string" || !isLedgerNamespace(namespace)) {
			continue;
		}
		try {
			validateLedgerDiff({
				path: diff.path,
				op: diff.op,
				value: diff.value,
				storyTime: diff.storyTime,
				source: diff.source as LedgerSource,
				confidence: diff.confidence,
			});
			covered.push([...diff.path]);
		} catch (error) {
			invalid.push({
				id: diff.id,
				path: diff.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { nodeId, raw: node.raw, covered, invalid };
}

function buildUserContent(
	floors: readonly WindowFloor[],
	snapshot: JsonObject,
): string {
	const lines = [
		"当前台账快照（截至窗口最后一楼）：",
		JSON.stringify(snapshot),
		"",
		"结算窗口：",
	];
	for (const floor of floors) {
		lines.push(`<楼层 id="${floor.nodeId}">`);
		lines.push("正文：");
		lines.push(floor.raw);
		if (floor.covered.length === 0) {
			lines.push("本楼层没有通过校验的结构化写入。");
		} else {
			lines.push("本楼层已经写入的路径（不要重复输出）：");
			for (const path of floor.covered) {
				lines.push(JSON.stringify(path));
			}
		}
		lines.push("</楼层>");
	}
	return lines.join("\n");
}

/** 解析整次请求：未知或重复的楼层 id 直接失败，窗口整体重试。 */
function parseSettleResponse(
	text: string,
	windowIds: readonly string[],
): Map<string, readonly unknown[]> {
	const parsed = parseJsonOutputArray(text, "结算结果");
	const byNode = new Map<string, readonly unknown[]>();
	for (const [index, item] of parsed.entries()) {
		const label = `结算结果[${index}]`;
		const record = assertPlainObject(item, label);
		rejectUnknownKeys(record, ["nodeId", "diffs"], label);
		const nodeId = record.nodeId;
		if (typeof nodeId !== "string" || !windowIds.includes(nodeId)) {
			throw new Error(`${label} 的 nodeId 不在结算窗口里：${String(nodeId)}`);
		}
		if (byNode.has(nodeId)) {
			throw new Error(`${label} 的 nodeId 重复：${nodeId}`);
		}
		if (!Array.isArray(record.diffs)) {
			throw new Error(`${label} 的 diffs 必须是数组`);
		}
		byNode.set(nodeId, record.diffs);
	}
	return byNode;
}

/**
 * 把一个楼层的模型输出整理成待写入的 diff：本楼层已有的写入优先，
 * 该楼层任一条目不合格时整条拒绝，其余楼层照常写入。
 */
function planFloor(
	floor: WindowFloor,
	proposals: readonly unknown[],
	storyId: string,
): SettledFloor {
	const covered = new Set(floor.covered.map((path) => JSON.stringify(path)));
	const accepted = new Map<
		string,
		{ readonly diff: NewStateDiff; readonly reason: string | null }
	>();
	const existingRepairs: LedgerRepair[] = floor.invalid.map((item) => ({
		path: item.path,
		action: "delete",
		reason: `本楼层已有的台账写入不合格：${item.reason}`,
	}));
	const rewrites: LedgerRepair[] = [];
	const rejections: LedgerRepair[] = [];
	for (const [index, raw] of proposals.entries()) {
		const label = `楼层 ${floor.nodeId} 的 diffs[${index}]`;
		let proposal: SettlerProposal;
		try {
			proposal = readProposal(raw, label);
		} catch (error) {
			rejections.push({
				path: bestEffortPath(raw),
				action: "delete",
				reason: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		const key = JSON.stringify(proposal.diff.path);
		if (covered.has(key)) continue;
		try {
			const diff = rewriteClueStatus(proposal.diff, rewrites);
			validateLedgerDiff({
				path: diff.path,
				op: diff.op,
				value: diff.value,
				storyTime: diff.storyTime,
				source: "settler",
				confidence: diff.confidence,
			});
			const common = {
				storyId,
				nodeId: floor.nodeId,
				path: diff.path,
				reason: proposal.reason,
				source: "settler" as const,
				storyTime: diff.storyTime,
				confidence: diff.confidence,
			};
			accepted.set(key, {
				diff:
					diff.op === "set"
						? { ...common, op: "set", value: diff.value }
						: { ...common, op: "delete" },
				reason: proposal.reason,
			});
		} catch (error) {
			rejections.push({
				path: proposal.diff.path,
				action: "delete",
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const deleteIds = floor.invalid.map((item) => item.id);
	if (rejections.length > 0) {
		return {
			nodeId: floor.nodeId,
			diffs: [],
			deleteIds,
			repairs: [...existingRepairs, ...rejections],
			source: "settler",
		};
	}
	const entries = [...accepted.values()];
	const fills: LedgerRepair[] = entries.map((entry) => ({
		path: entry.diff.path,
		action: "fill",
		reason: entry.reason ?? "结算器补齐了本楼层没有写入的事实",
	}));
	return {
		nodeId: floor.nodeId,
		diffs: entries.map((entry) => entry.diff),
		deleteIds,
		repairs: [...existingRepairs, ...rewrites, ...fills],
		source:
			entries.length === 0 &&
			rewrites.length === 0 &&
			existingRepairs.length === 0
				? "model"
				: "settler",
	};
}

function readProposal(value: unknown, label: string): SettlerProposal {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, DIFF_FIELDS, label);
	const path = readPath(record.path, `${label}.path`);
	const op = record.op;
	if (op !== "set" && op !== "delete") {
		throw new Error(`${label}.op 只能是 set 或 delete，收到 ${String(op)}`);
	}
	if (op === "delete" && Object.hasOwn(record, "value")) {
		throw new Error(`${label} 的 delete 不能带 value`);
	}
	if (op === "set" && !Object.hasOwn(record, "value")) {
		throw new Error(`${label} 的 set 必须带 value`);
	}
	const confidence = assertLedgerConfidence(
		record.confidence,
		`${label}.confidence`,
	);
	if (confidence === null) {
		throw new Error(`${label}.confidence 必须是 0 到 1 的数字`);
	}
	const storyTime = readStoryTime(record.storyTime, `${label}.storyTime`);
	const reason = readReason(record.reason, `${label}.reason`);
	return {
		diff: {
			path,
			op,
			value: op === "set" ? record.value : null,
			storyTime,
			confidence,
		},
		reason,
	};
}

function readPath(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是字符串组成的非空数组`);
	}
	const path: string[] = [];
	for (const [index, segment] of value.entries()) {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
		path.push(segment);
	}
	return path;
}

function readStoryTime(value: unknown, label: string): StoryTime | null {
	if (value === undefined || value === null) return null;
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["start", "end"], label);
	return {
		start: readBound(record.start, `${label}.start`),
		end: readBound(record.end, `${label}.end`),
	};
}

function readBound(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串或 null`);
	}
	return value;
}

function readReason(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

/** 只把线索状态改写成允许取值；其他非法值留给校验拒绝。 */
function rewriteClueStatus(
	proposal: SettlerProposal["diff"],
	repairs: LedgerRepair[],
): SettlerProposal["diff"] {
	const { path, op, value } = proposal;
	if (op !== "set" || path.length !== 3) return proposal;
	if (path[0] !== "clue" || path[2] !== "status") return proposal;
	if (typeof value !== "string") return proposal;
	if ((CLUE_STATUSES as readonly string[]).includes(value)) return proposal;
	const mapped = CLUE_STATUS_ALIASES[value];
	if (mapped === undefined) return proposal;
	repairs.push({
		path,
		action: "rewrite_status",
		reason: `线索状态 ${JSON.stringify(value)} 不在允许取值里，改写为 ${mapped}`,
	});
	return { ...proposal, value: mapped };
}

function bestEffortPath(value: unknown): readonly string[] {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const path = (value as Record<string, unknown>).path;
		if (Array.isArray(path) && path.length > 0) {
			if (
				path.every(
					(segment) => typeof segment === "string" && segment.length > 0,
				)
			) {
				return path as readonly string[];
			}
		}
	}
	return ["-"];
}
