import type { BackgroundJobHandler } from "../background/types.js";
import {
	type ResolvedDirectorBeat,
	resolveCurrentBeat,
} from "../director/plan.js";
import {
	type EntityKind,
	type NewEntityInput,
	normalizeEntityName,
} from "../entity.js";
import {
	type JsonObject,
	assertPlainObject,
	isJsonObject,
	rejectUnknownKeys,
} from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputArray } from "../memory/json-output.js";
import { quoteMatches } from "../memory/quote.js";
import type { StoryStore } from "../store/story-store.js";
import type {
	NewStateDiff,
	StateDiffOp,
	StoryTime,
	TimelineNode,
} from "../timeline.js";
import { ledgerChangeCardId, readBeforeEntry } from "./cards.js";
import {
	CLUE_STATUSES,
	type LedgerSource,
	assertLedgerConfidence,
	isLedgerNamespace,
	validateLedgerDiff,
} from "./schema.js";
import type { LedgerRepair, NewEntityCandidateInput } from "./settlement.js";

export const SETTLE_JOB_KIND = "settle";
export const SETTLE_WINDOW_FLOORS = 4;
export const SETTLE_CONFLICT_WINDOW_FLOORS = 6;

export interface PrepareSettlementOptions {
	/** 一次结算请求最多覆盖的楼层数；默认 4。 */
	readonly windowSize?: number;
	/** 与结算事实对比的最近原文楼层数；默认 6。 */
	readonly conflictWindowFloors?: number;
}

export interface SettleHandlerOptions extends PrepareSettlementOptions {
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
	"sourceQuote",
];

/**
 * 台账命名空间与路径的说明；单独导出给合并调用复用，避免两处各写一份。
 */
export const LEDGER_PATH_GUIDE: readonly string[] = [
	"- character.<人物 id>.<tier|identity|appearance|outfit|status|location>，tier 取 lead 或 minor",
	'- relation.<from>.<to>.<type|stage|turningPoint|affectionInner|affectionOuter|inertia>，好感取 "敌对"、"冷淡"、"平常"、"亲近"、"倾心"，inertia 是 0 到 1',
	"- item.<物品 id>.<holder|location|origin>；item.<物品 id>.log.<条目 id> 的值是 {text,nodeId,at}",
	"- scene.places.<地点 id>.<name|description|parent>；scene.current.<place|posture|atmosphere|participants>",
	"- time.current 的值是故事内时间",
	"- clue.<线索 id>.<text|status|openedAt|updatedAt>，status 取 open、progress、fulfilled",
	"- knowledge.<知情者>.<条目 id> 的值是 {factId,text}；factId 指向事件或线索的 id，同一个人对同一 factId 只写一次",
	"- userWill.<id> 的值是 {kind,text,sourceNodeId,createdAt}",
	"- mvu.<原始变量路径> 表示导入的 MVU 变量",
	"- 人物、地点、物品的 id 直接写名称，程序会按实体表规范化。",
];

const BASE_SYSTEM_PROMPT = [
	"你是故事台账的结算器。阅读结算窗口里的楼层正文、最近楼层的原文与当前台账快照，为每个楼层补齐正文已经确立、但楼层自己没有写入的台账事实。",
	"只输出一个 JSON 数组，不要输出解释、前后缀或代码块标记。每一项形如：",
	'{"nodeId":"楼层 id","diffs":[{"path":["clue","c1","status"],"op":"set","value":"open","confidence":0.8,"reason":"一句话依据"}],"conflicts":[{"path":["character","凛","location"],"reason":"最近一楼明确写她还在教室"}]}',
	"- nodeId 必须是窗口里出现过的楼层 id，每个楼层最多出现一次。",
	"- path 至少两段：第一段是命名空间，后续路径段按命名空间的结构书写。",
	"- op 只能是 set 或 delete；delete 不能带 value。",
	"- confidence 是 0 到 1 的数字，表示这条事实有多确定。",
	"- reason 可选，写一句话说明正文里的依据。",
	"- 楼层里已经写入的路径不要重复输出。",
	"- 不要写正文里没有依据的事实；没有需要补的楼层仍然输出一项，diffs 为空数组。",
	"- 要写的事实如果与“冲突检查窗口”的原文明确矛盾，不要写进 diffs，写进同一楼层的 conflicts；conflicts 只写 path 与 reason，不写值。已有事实与最近原文一致时保留已有值。",
];

/** 卡定义的状态表：只把标题与正文送进结算提示词，正文过长时截断。 */
export interface SettlementStateDefinition {
	readonly title: string;
	readonly content: string;
}

export const STATE_DEFINITION_ENTRY_CHAR_LIMIT = 800;
export const STATE_DEFINITION_TOTAL_CHAR_LIMIT = 4_000;

/** 拼出状态定义段；条目为空时返回空数组，调用方决定是否加这段。 */
export function formatStateDefinitions(
	definitions: readonly SettlementStateDefinition[],
): string[] {
	const lines: string[] = [];
	let used = 0;
	let omitted = false;
	for (const definition of definitions) {
		if (used >= STATE_DEFINITION_TOTAL_CHAR_LIMIT) {
			omitted = true;
			break;
		}
		const title = definition.title.trim() || "未命名条目";
		const remaining = STATE_DEFINITION_TOTAL_CHAR_LIMIT - used;
		const limit = Math.min(STATE_DEFINITION_ENTRY_CHAR_LIMIT, remaining);
		const content = definition.content.trim();
		const clipped = content.length > limit;
		const text = clipped ? `${content.slice(0, limit)}…` : content;
		lines.push(`【${title}】${text}`);
		used += text.length;
		if (clipped) omitted = true;
	}
	if (omitted) lines.push("（其余状态定义已省略）");
	return lines;
}

/** 存在当前拍时才出现的说明：完成判断是可选的，不要求模型每层都回答。 */
export const SETTLEMENT_BEAT_PROMPT =
	"- 楼层里给出“当前拍”时，如果你确信这一层的正文让该拍完成，可以把这一项的 beatCompleted 设为 true；没有完成、判断不了或者与这一层无关，就省略这个字段，不要为了填满字段而猜测。";

function buildSettlementSystemPrompt(
	hasBeats: boolean,
	stateDefinitions: readonly SettlementStateDefinition[],
): string {
	const stateLines = formatStateDefinitions(stateDefinitions);
	return [
		...BASE_SYSTEM_PROMPT,
		...(hasBeats ? [SETTLEMENT_BEAT_PROMPT] : []),
		"命名空间与路径：",
		...LEDGER_PATH_GUIDE,
		...(stateLines.length === 0
			? []
			: [
					"卡定义的状态定义（变量与更新规则；变量写入走 mvu.<变量路径>）：",
					...stateLines,
				]),
	].join("\n");
}

interface SettlerProposal {
	readonly diff: {
		readonly path: readonly string[];
		readonly op: "set" | "delete";
		readonly value: unknown;
		readonly storyTime: StoryTime | null;
		readonly confidence: number;
		/** 正文里支撑这条事实的原句；模型没给时为 null，只用来定位，宽松匹配。 */
		readonly sourceQuote: string | null;
	};
	readonly reason: string | null;
}

export interface SettlerConflict {
	readonly path: readonly string[];
	readonly reason: string;
}

export interface FloorProposals {
	readonly diffs: readonly unknown[];
	readonly conflicts: readonly SettlerConflict[];
	/** 模型判断这一层是否让当前拍完成；缺少该字段时为 false，null 表示不写拍状态。 */
	readonly beatCompleted: boolean | null;
	/** beatCompleted 类型非法时的原因；非空时该楼层整条拒绝。 */
	readonly beatCompletedError: string | null;
}

interface SettledFloor {
	readonly nodeId: string;
	readonly diffs: readonly NewStateDiff[];
	/** 本楼层已有的不合格台账写入，写入前删除。 */
	readonly deleteIds: readonly number[];
	readonly repairs: readonly LedgerRepair[];
	/** 与最近原文冲突、没有写进台账的提案；逐条转成待审变更卡。 */
	readonly conflictFacts: readonly ConflictFact[];
	readonly source: LedgerSource;
	/** 本楼层整条被拒绝时不写拍状态。 */
	readonly rejected: boolean;
	/** 没有模型条目时为 null，此时也不写拍状态。 */
	readonly beatCompleted: boolean | null;
}

interface ConflictFact {
	readonly path: readonly string[];
	readonly reason: string;
	readonly diff: SettlerProposal["diff"];
}

export interface InvalidExistingDiff {
	readonly id: number;
	readonly path: readonly string[];
	readonly reason: string;
}

export interface CoveredPath {
	readonly path: readonly string[];
	readonly op: StateDiffOp;
}

export interface WindowFloor {
	readonly nodeId: string;
	readonly parentId: string | null;
	readonly raw: string;
	/** 已通过校验的台账路径：本楼层已有写入，结算器跳过。 */
	readonly covered: readonly CoveredPath[];
	readonly invalid: readonly InvalidExistingDiff[];
}

/** 某个楼层在结算时对应的当前拍；没有计划或拍已耗尽时整份为 null。 */
export interface WindowBeat {
	readonly nodeId: string;
	readonly arcId: string;
	readonly sequenceId: string;
	readonly beatId: string;
	readonly goal: string;
}

/** 人物、地点、物品名称的规范写法；键是类别与规范化名称。 */
type EntityCanonicalNames = ReadonlyMap<string, string>;

interface EntityResolution {
	readonly canonical: EntityCanonicalNames;
	/** 本窗口里出现、但还没有建档的名称，逐次写入以累加命中次数。 */
	readonly candidates: readonly NewEntityCandidateInput[];
	/** 本窗口出现两次以上或被正文模型直接写入的名称，立即建档。 */
	readonly promoted: readonly NewEntityInput[];
}

/** 一次结算要处理的全部输入：窗口楼层、台账快照与冲突检查窗口。 */
export interface SettlementWindow {
	readonly storyId: string;
	readonly nodeIds: readonly string[];
	readonly floors: readonly WindowFloor[];
	readonly snapshot: JsonObject;
	readonly conflictWindow: readonly TimelineNode[];
	/** 每个楼层对应的当前拍；没有计划或拍已耗尽时为 null。 */
	readonly beats: readonly WindowBeat[] | null;
	/** 卡定义的状态定义条目；结算器据此维护硬状态。 */
	readonly stateDefinitions: readonly SettlementStateDefinition[];
}

/**
 * 读取当前路径上待结算的窗口。没有待结算楼层时返回 null。
 */
export function prepareSettlement(
	store: StoryStore,
	storyId: string,
	options: PrepareSettlementOptions = {},
): SettlementWindow | null {
	const { windowSize } = resolveSettlementOptions(options);
	const nodeIds = store.listUnsettledSettledAssistantNodes(storyId, windowSize);
	if (nodeIds.length === 0) return null;
	return prepareSettlementForNodes(store, storyId, nodeIds, options);
}

/**
 * 按显式楼层构建结算窗口，用于评测预热这类需要指定窗口的调用；楼层顺序
 * 按路径从旧到新，调用方保证它们都在当前 head 路径上。
 */
export function prepareSettlementForNodes(
	store: StoryStore,
	storyId: string,
	nodeIds: readonly string[],
	options: PrepareSettlementOptions = {},
): SettlementWindow | null {
	if (nodeIds.length === 0) return null;
	const { windowSize, conflictWindowFloors } =
		resolveSettlementOptions(options);
	if (nodeIds.length > windowSize) {
		throw new Error(
			`结算窗口最多 ${windowSize} 个楼层，收到 ${nodeIds.length} 个`,
		);
	}
	const floors = nodeIds.map((nodeId) => readWindowFloor(store, nodeId));
	const snapshotNodeId = nodeIds[nodeIds.length - 1] as string;
	const snapshot = store.getStateSnapshot(snapshotNodeId).state;
	const conflictWindow = readConflictWindow(
		store,
		storyId,
		snapshotNodeId,
		conflictWindowFloors,
	);
	const beats = readWindowBeats(store, storyId, floors);
	const stateDefinitions = store
		.listImportAuditEntries(storyId)
		.filter((entry) => entry.kind === "state")
		.map((entry) => ({ title: entry.title, content: entry.content }));
	return {
		storyId,
		nodeIds,
		floors,
		snapshot,
		conflictWindow,
		beats,
		stateDefinitions,
	};
}

/** 结算请求的消息；合并调用自己组装提示词，但复用同一份窗口数据。 */
export function buildSettlementMessages(
	window: SettlementWindow,
): LlmMessage[] {
	const hasBeats = window.beats !== null;
	return [
		{
			role: "system",
			content: buildSettlementSystemPrompt(hasBeats, window.stateDefinitions),
		},
		{
			role: "user",
			content: buildUserContent(
				window.floors,
				window.snapshot,
				window.conflictWindow,
				window.beats,
			),
		},
	];
}

/** 生成台账结算的后台任务处理器。 */
export function createSettleHandler(
	options: SettleHandlerOptions = {},
): BackgroundJobHandler {
	const resolved = resolveSettlementOptions(options);
	return async ({ store, client, job, signal }) => {
		const window = prepareSettlement(store, job.storyId, resolved);
		if (window === null) return;
		const result = await client.complete(
			{
				messages: buildSettlementMessages(window),
				model: options.model,
				temperature: 0,
				signal,
			},
			NO_CONTINUATION,
		);
		applySettlementProposals(
			store,
			window,
			parseSettleResponse(result.text, window.nodeIds),
		);
	};
}

/**
 * 把整次结算输出写进台账：实体候选、实体建档、逐楼层的 diff 与变更卡在
 * 同一个事务里提交。
 */
export function applySettlementProposals(
	store: StoryStore,
	window: SettlementWindow,
	proposals: ReadonlyMap<string, FloorProposals>,
): void {
	const resolution = resolveWindowEntities(
		store,
		window.storyId,
		window.floors,
		proposals,
	);
	const knowledgeFacts = collectKnowledgeFacts(window.snapshot);
	const plans = window.floors.map((floor) =>
		planFloor(
			floor,
			proposals.get(floor.nodeId) ?? null,
			window.storyId,
			resolution.canonical,
			knowledgeFacts,
		),
	);
	store.runInTransaction(() => {
		const beatByNode = new Map(
			(window.beats ?? []).map((beat) => [beat.nodeId, beat]),
		);
		const floorByNode = new Map(
			window.floors.map((floor) => [floor.nodeId, floor]),
		);
		for (const candidate of resolution.candidates) {
			store.upsertEntityCandidate(candidate);
		}
		for (const entity of resolution.promoted) {
			store.upsertEntity(entity);
		}
		for (const plan of plans) {
			if (plan.deleteIds.length > 0) {
				store.deleteStateDiffs(plan.nodeId, plan.deleteIds);
			}
			if (plan.diffs.length > 0) {
				store.appendStateDiffs(plan.diffs);
			}
			store.recordLedgerSettlement({
				nodeId: plan.nodeId,
				storyId: window.storyId,
				source: plan.source,
				addedCount: plan.diffs.length,
				repairs: plan.repairs,
			});
			const beat = beatByNode.get(plan.nodeId);
			const parentId = floorByNode.get(plan.nodeId)?.parentId ?? null;
			if (
				beat !== undefined &&
				parentId !== null &&
				!plan.rejected &&
				plan.beatCompleted !== null
			) {
				// 结算窗口里的楼层按路径顺序处理；上一楼写下的完成记录会改变
				// 下一楼父节点处解析出的当前拍。
				const resolved = resolveCurrentBeat(store, window.storyId, parentId);
				if (resolved !== null && resolved.beat.id === beat.beatId) {
					store.saveDirectorBeatState({
						nodeId: plan.nodeId,
						storyId: window.storyId,
						beatId: beat.beatId,
						completed: plan.beatCompleted,
					});
				}
			}
			for (const fact of plan.conflictFacts) {
				store.insertLedgerChangeCard({
					id: ledgerChangeCardId([
						"settle",
						plan.nodeId,
						JSON.stringify(fact.path),
					]),
					storyId: window.storyId,
					source: "settler",
					sourceNodeId: plan.nodeId,
					text: fact.reason,
					diffs: [
						fact.diff.op === "set"
							? {
									path: fact.diff.path,
									op: "set",
									value: fact.diff.value,
								}
							: { path: fact.diff.path, op: "delete" },
					],
					before: [readBeforeEntry(window.snapshot, fact.path)],
					status: "pending",
				});
			}
		}
	});
}

function resolveSettlementOptions(
	options: PrepareSettlementOptions,
): Required<PrepareSettlementOptions> {
	const windowSize = options.windowSize ?? SETTLE_WINDOW_FLOORS;
	if (!Number.isInteger(windowSize) || windowSize < 1) {
		throw new Error("结算窗口的楼层数必须是正整数");
	}
	const conflictWindowFloors =
		options.conflictWindowFloors ?? SETTLE_CONFLICT_WINDOW_FLOORS;
	if (!Number.isInteger(conflictWindowFloors) || conflictWindowFloors < 1) {
		throw new Error("冲突检查窗口的楼层数必须是正整数");
	}
	return { windowSize, conflictWindowFloors };
}

function readWindowFloor(store: StoryStore, nodeId: string): WindowFloor {
	const node = store.getNode(nodeId);
	if (!node) {
		throw new Error(`结算窗口里的楼层不存在：${nodeId}`);
	}
	const covered: CoveredPath[] = [];
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
			covered.push({ path: [...diff.path], op: diff.op });
		} catch (error) {
			invalid.push({
				id: diff.id,
				path: diff.path,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { nodeId, parentId: node.parentId, raw: node.raw, covered, invalid };
}

function buildUserContent(
	floors: readonly WindowFloor[],
	snapshot: JsonObject,
	conflictWindow: readonly TimelineNode[],
	beats: readonly WindowBeat[] | null,
): string {
	const beatByNode = new Map((beats ?? []).map((beat) => [beat.nodeId, beat]));
	const lines = [
		"当前台账快照（截至窗口最后一楼）：",
		JSON.stringify(snapshot),
		"",
		"冲突检查窗口（最近楼层的原文，只用来核对冲突，不是可写入的楼层）：",
	];
	for (const node of conflictWindow) {
		lines.push(`<最近楼层 角色="${node.role}">`);
		lines.push(node.raw);
		lines.push("</最近楼层>");
	}
	lines.push("", "结算窗口：");
	for (const floor of floors) {
		lines.push(`<楼层 id="${floor.nodeId}">`);
		const beat = beatByNode.get(floor.nodeId);
		if (beat !== undefined) {
			lines.push(`当前拍：${beat.beatId}（目标：${beat.goal}）`);
		}
		lines.push("正文：");
		lines.push(floor.raw);
		if (floor.covered.length === 0) {
			lines.push("本楼层没有通过校验的结构化写入。");
		} else {
			lines.push("本楼层已经写入的路径（不要重复输出）：");
			for (const covered of floor.covered) {
				lines.push(JSON.stringify(covered.path));
			}
		}
		lines.push("</楼层>");
	}
	return lines.join("\n");
}

/** 每个楼层在它父节点处的当前拍；没有计划、拍已耗尽或根楼层时不写。 */
function readWindowBeats(
	store: StoryStore,
	storyId: string,
	floors: readonly WindowFloor[],
): WindowBeat[] | null {
	const beats: WindowBeat[] = [];
	for (const floor of floors) {
		if (floor.parentId === null) continue;
		const resolved = resolveCurrentBeat(store, storyId, floor.parentId);
		if (resolved === null) continue;
		beats.push(beatOf(floor.nodeId, resolved));
	}
	return beats.length === 0 ? null : beats;
}

function beatOf(nodeId: string, resolved: ResolvedDirectorBeat): WindowBeat {
	return {
		nodeId,
		arcId: resolved.arc.id,
		sequenceId: resolved.sequence.id,
		beatId: resolved.beat.id,
		goal: resolved.beat.goal,
	};
}

/** 解析整次请求：未知或重复的楼层 id 直接失败，窗口整体重试。 */
export function parseSettleResponse(
	text: string,
	windowIds: readonly string[],
): Map<string, FloorProposals> {
	const parsed = parseJsonOutputArray(text, "结算结果");
	const byNode = new Map<string, FloorProposals>();
	for (const [index, item] of parsed.entries()) {
		const label = `结算结果[${index}]`;
		const record = assertPlainObject(item, label);
		rejectUnknownKeys(
			record,
			["nodeId", "diffs", "conflicts", "beatCompleted"],
			label,
		);
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
		const conflicts = record.conflicts ?? [];
		if (!Array.isArray(conflicts)) {
			throw new Error(`${label} 的 conflicts 必须是数组`);
		}
		let beatCompleted = false;
		let beatCompletedError: string | null = null;
		if (Object.hasOwn(record, "beatCompleted")) {
			if (typeof record.beatCompleted === "boolean") {
				beatCompleted = record.beatCompleted;
			} else {
				beatCompletedError = `${label}.beatCompleted 必须是布尔值，收到 ${JSON.stringify(record.beatCompleted)}`;
			}
		}
		byNode.set(nodeId, {
			diffs: record.diffs,
			conflicts: conflicts.map((conflict, conflictIndex) =>
				readConflict(conflict, `${label}.conflicts[${conflictIndex}]`),
			),
			beatCompleted,
			beatCompletedError,
		});
	}
	return byNode;
}

function readConflict(value: unknown, label: string): SettlerConflict {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, ["path", "reason"], label);
	return {
		path: readPath(record.path, `${label}.path`),
		reason: readRequiredText(record.reason, `${label}.reason`),
	};
}

function readRequiredText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

/** 结算窗口与冲突检查使用的最近楼层原文；以当前 head 为终点。 */
function readConflictWindow(
	store: StoryStore,
	storyId: string,
	fallbackNodeId: string,
	floors: number,
): TimelineNode[] {
	const headPath = store.getPathToHead(storyId);
	const path =
		headPath.length > 0 ? headPath : store.getPathToNode(fallbackNodeId);
	return path.slice(-floors);
}

interface EntityOccurrence {
	readonly kind: EntityKind;
	readonly name: string;
	readonly nodeId: string;
	readonly modelDirect: boolean;
}

/**
 * 把窗口里人物、地点、物品的名称对照实体与别名表：已建档的名称换成实体
 * 的规范写法；没建档的名称只出现一次时记入候选，出现两次以上或被正文
 * 模型直接写入时立即建档。
 */
function resolveWindowEntities(
	store: StoryStore,
	storyId: string,
	floors: readonly WindowFloor[],
	proposals: ReadonlyMap<string, FloorProposals>,
): EntityResolution {
	const occurrences: EntityOccurrence[] = [];
	for (const floor of floors) {
		for (const covered of floor.covered) {
			if (covered.op !== "set") continue;
			for (const ref of entityReferences(covered.path)) {
				occurrences.push({
					kind: ref.kind,
					name: covered.path[ref.index] as string,
					nodeId: floor.nodeId,
					modelDirect: true,
				});
			}
		}
		for (const raw of proposals.get(floor.nodeId)?.diffs ?? []) {
			const path = proposalPathForResolution(raw);
			if (path === null) continue;
			for (const ref of entityReferences(path)) {
				occurrences.push({
					kind: ref.kind,
					name: path[ref.index] as string,
					nodeId: floor.nodeId,
					modelDirect: false,
				});
			}
		}
	}
	const groups = new Map<string, EntityOccurrence[]>();
	for (const occurrence of occurrences) {
		if (normalizeEntityName(occurrence.name).length === 0) continue;
		const key = entityKey(occurrence.kind, occurrence.name);
		const group = groups.get(key);
		if (group === undefined) {
			groups.set(key, [occurrence]);
		} else {
			group.push(occurrence);
		}
	}
	const canonical = new Map<string, string>();
	const candidates: NewEntityCandidateInput[] = [];
	const promoted: NewEntityInput[] = [];
	for (const [key, group] of groups) {
		const first = group[0] as EntityOccurrence;
		const known = store
			.resolveEntities(first.name, { storyId })
			.find((entity) => entity.kind === first.kind);
		if (known !== undefined) {
			canonical.set(key, known.name);
			continue;
		}
		canonical.set(key, first.name);
		const modelDirect = group.some((occurrence) => occurrence.modelDirect);
		if (modelDirect || group.length >= 2) {
			promoted.push({
				storyId,
				kind: first.kind,
				name: first.name,
				source: modelDirect ? "model" : "settler",
			});
			continue;
		}
		candidates.push({
			storyId,
			name: first.name,
			kind: first.kind,
			nodeId: first.nodeId,
		});
	}
	return { canonical, candidates, promoted };
}

/** 台账路径里的人物、地点、物品名称各在哪个路径段。 */
function entityReferences(
	path: readonly string[],
): readonly { readonly kind: EntityKind; readonly index: number }[] {
	switch (path[0]) {
		case "character":
			return path.length >= 2 ? [{ kind: "character", index: 1 }] : [];
		case "relation":
			return path.length >= 3
				? [
						{ kind: "character", index: 1 },
						{ kind: "character", index: 2 },
					]
				: [];
		case "item":
			return path.length >= 2 ? [{ kind: "item", index: 1 }] : [];
		case "scene":
			return path.length >= 3 && path[1] === "places"
				? [{ kind: "location", index: 2 }]
				: [];
		default:
			return [];
	}
}

function canonicalizePath(
	path: readonly string[],
	canonical: EntityCanonicalNames,
): string[] {
	const next = [...path];
	for (const ref of entityReferences(path)) {
		const name = canonical.get(entityKey(ref.kind, path[ref.index] as string));
		if (name !== undefined) {
			next[ref.index] = name;
		}
	}
	return next;
}

function entityKey(kind: EntityKind, name: string): string {
	return `${kind}\u0000${normalizeEntityName(name)}`;
}

/** 只从可以读出路径的 set 提案里收集实体名称；不合法条目留给校验拒绝。 */
function proposalPathForResolution(value: unknown): readonly string[] | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.op !== "set") return null;
	const path = record.path;
	if (!Array.isArray(path) || path.length === 0) return null;
	if (
		!path.every((segment) => typeof segment === "string" && segment.length > 0)
	) {
		return null;
	}
	return path as readonly string[];
}

/** 沿路径已经生效的知情条目，按知情者与 factId 去重。 */
function collectKnowledgeFacts(snapshot: JsonObject): Set<string> {
	const facts = new Set<string>();
	const knowledge = snapshot.knowledge;
	if (!isJsonObject(knowledge)) return facts;
	for (const [knower, entries] of Object.entries(knowledge)) {
		if (!isJsonObject(entries)) continue;
		for (const entry of Object.values(entries)) {
			if (!isJsonObject(entry)) continue;
			const factId = entry.factId;
			if (typeof factId === "string" && factId.length > 0) {
				facts.add(knowledgeKey(knower, factId));
			}
		}
	}
	return facts;
}

function knowledgeFactKey(diff: SettlerProposal["diff"]): string | null {
	if (
		diff.op !== "set" ||
		diff.path[0] !== "knowledge" ||
		diff.path.length !== 3
	) {
		return null;
	}
	if (!isJsonObject(diff.value)) return null;
	const factId = diff.value.factId;
	if (typeof factId !== "string" || factId.length === 0) return null;
	return knowledgeKey(diff.path[1] as string, factId);
}

function knowledgeKey(knower: string, factId: string): string {
	return `${knower}\u0000${factId}`;
}

/**
 * 把一个楼层的模型输出整理成待写入的 diff：本楼层已有的写入优先，
 * 该楼层任一条目不合格时整条拒绝，其余楼层照常写入。冲突事实只记入修复。
 */
function planFloor(
	floor: WindowFloor,
	proposals: FloorProposals | null,
	storyId: string,
	canonical: EntityCanonicalNames,
	knowledgeFacts: Set<string>,
): SettledFloor {
	const diffs = proposals?.diffs ?? [];
	const covered = new Set(
		floor.covered.map((item) =>
			JSON.stringify(canonicalizePath(item.path, canonical)),
		),
	);
	const accepted = new Map<
		string,
		{ readonly diff: NewStateDiff; readonly reason: string | null }
	>();
	const existingRepairs: LedgerRepair[] = floor.invalid.map((item) => ({
		path: item.path,
		action: "delete",
		reason: `本楼层已有的台账写入不合格：${item.reason}`,
	}));
	const conflictRepairs: LedgerRepair[] = (proposals?.conflicts ?? []).map(
		(conflict) => {
			const path = canonicalizePath(conflict.path, canonical);
			return {
				path,
				action: "conflict",
				reason: `最近楼层的原文与该事实冲突：${conflict.reason}`,
			};
		},
	);
	const conflictPaths = new Set(
		conflictRepairs.map((repair) => JSON.stringify(repair.path)),
	);
	const conflicting = new Map<string, SettlerProposal["diff"]>();
	const rewrites: LedgerRepair[] = [];
	const rejections: LedgerRepair[] = [];
	if (proposals?.beatCompletedError != null) {
		rejections.push({
			path: ["-"],
			action: "delete",
			reason: proposals.beatCompletedError,
		});
	}
	for (const [index, raw] of diffs.entries()) {
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
		const path = canonicalizePath(proposal.diff.path, canonical);
		const key = JSON.stringify(path);
		if (covered.has(key)) continue;
		// v5 §3.5：引文只用来定位，对不上照样按楼层锚点写入；「谁得知了什么」
		// 例外，原文里没有得知经过就是泄密。
		if (
			path[0] === "knowledge" &&
			proposal.diff.sourceQuote !== null &&
			!quoteMatches(floor.raw, proposal.diff.sourceQuote)
		) {
			rejections.push({
				path,
				action: "delete",
				reason: `${label}：让未知情者知道了秘密，原文里没有得知的经过`,
			});
			continue;
		}
		try {
			const diff = rewriteClueStatus({ ...proposal.diff, path }, rewrites);
			validateLedgerDiff({
				path: diff.path,
				op: diff.op,
				value: diff.value,
				storyTime: diff.storyTime,
				source: "settler",
				confidence: diff.confidence,
			});
			if (conflictPaths.has(key)) {
				conflicting.set(key, diff);
				continue;
			}
			const knowledgeKey = knowledgeFactKey(diff);
			if (knowledgeKey !== null) {
				if (knowledgeFacts.has(knowledgeKey)) continue;
				knowledgeFacts.add(knowledgeKey);
			}
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
				path,
				action: "delete",
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	const deleteIds = floor.invalid.map((item) => item.id);
	const conflictFacts: ConflictFact[] = conflictRepairs.flatMap((repair) => {
		const diff = conflicting.get(JSON.stringify(repair.path));
		if (diff === undefined) return [];
		return [{ path: repair.path, reason: repair.reason, diff }];
	});
	const beatCompleted = proposals === null ? null : proposals.beatCompleted;
	if (rejections.length > 0) {
		return {
			nodeId: floor.nodeId,
			diffs: [],
			deleteIds,
			repairs: [...existingRepairs, ...conflictRepairs, ...rejections],
			conflictFacts,
			source: "settler",
			rejected: true,
			beatCompleted,
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
		repairs: [...existingRepairs, ...rewrites, ...conflictRepairs, ...fills],
		conflictFacts,
		source:
			entries.length === 0 &&
			rewrites.length === 0 &&
			existingRepairs.length === 0 &&
			conflictRepairs.length === 0
				? "model"
				: "settler",
		rejected: false,
		beatCompleted,
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
	const sourceQuote = readReason(record.sourceQuote, `${label}.sourceQuote`);
	return {
		diff: {
			path,
			op,
			value: op === "set" ? record.value : null,
			storyTime,
			confidence,
			sourceQuote,
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
