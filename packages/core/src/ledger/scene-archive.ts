import type { BackgroundJobHandler } from "../background/types.js";
import { assertPlainObject, isJsonObject, rejectUnknownKeys } from "../json.js";
import { type LlmMessage, NO_CONTINUATION } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { StoryStore } from "../store/story-store.js";
import {
	type SceneInformed,
	type SceneProfileUpdate,
	assertSceneArchiveLinks,
	assertSceneInformedList,
	assertSceneProfileUpdates,
} from "./character-profile.js";
import { readLedger } from "./read.js";
import {
	DEFAULT_MAX_SCENE_FLOORS,
	type SceneBoundary,
	type SceneSegment,
	assertMaxSceneFloors,
	isSceneBoundary,
	readSceneSegments,
} from "./scenes.js";

export const SCENE_ARCHIVE_JOB_KIND = "scene_archive";

const RESPONSE_KEYS = [
	"summary",
	"present",
	"profiles",
	"informed",
	"stateChanges",
	"cluesOpened",
	"cluesClosed",
] as const;

const STATE_CHANGE_KEYS = ["path", "change"] as const;

const SCENE_BOUNDARIES_TEXT = "scene-ends、max-floors 或 player-ends";

/** 归档提示词里带上的之前场次数量上限；informed 只能引用这些 id。 */
const PRIOR_SCENE_LIMIT = 6;

/** 一条状态变化：这一场改过的台账路径与变化内容。 */
export interface SceneStateChange {
	readonly path: readonly string[];
	readonly change: string;
}

/** 一场结束时的归档；按结束楼层保存，同一场次只有一行。 */
export interface SceneArchive {
	readonly endNodeId: string;
	readonly storyId: string;
	readonly startNodeId: string;
	readonly floorCount: number;
	readonly boundary: SceneBoundary;
	readonly summary: string;
	readonly present: readonly string[];
	readonly profiles: readonly SceneProfileUpdate[];
	readonly informed: readonly SceneInformed[];
	readonly stateChanges: readonly SceneStateChange[];
	readonly cluesOpened: readonly string[];
	readonly cluesClosed: readonly string[];
	readonly createdAt: string;
}

export interface NewSceneArchive {
	readonly endNodeId: string;
	readonly storyId: string;
	readonly startNodeId: string;
	readonly floorCount: number;
	readonly boundary: SceneBoundary;
	readonly summary: string;
	readonly present: readonly string[];
	readonly profiles: readonly SceneProfileUpdate[];
	readonly informed: readonly SceneInformed[];
	readonly stateChanges: readonly SceneStateChange[];
	readonly cluesOpened: readonly string[];
	readonly cluesClosed: readonly string[];
	readonly createdAt?: string;
}

/** 归档输出里由模型填写的部分。 */
export interface ParsedSceneArchive {
	readonly summary: string;
	readonly present: readonly string[];
	readonly profiles: readonly SceneProfileUpdate[];
	readonly informed: readonly SceneInformed[];
	readonly stateChanges: readonly SceneStateChange[];
	readonly cluesOpened: readonly string[];
	readonly cluesClosed: readonly string[];
}

/** 校验存储里的一条状态变化；路径只查形状。 */
export function assertSceneStateChange(
	value: unknown,
	label: string,
): SceneStateChange {
	const record = assertPlainObject(value, label);
	rejectUnknownKeys(record, STATE_CHANGE_KEYS, label);
	if (!Array.isArray(record.path) || record.path.length === 0) {
		throw new Error(`${label}.path 必须是字符串组成的非空数组`);
	}
	const path: string[] = [];
	for (const [index, segment] of record.path.entries()) {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`${label}.path[${index}] 必须是非空字符串`);
		}
		path.push(segment);
	}
	return {
		path,
		change: requireNonEmptyString(record.change, `${label}.change`),
	};
}

/** 校验存储里的一组状态变化；错误信息带序号。 */
export function assertSceneStateChanges(
	value: unknown,
	label: string,
): readonly SceneStateChange[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value.map((item, index) =>
		assertSceneStateChange(item, `${label}[${index}]`),
	);
}

/** 供存储层读取时复用的完整校验；返回字段齐全的副本。 */
export function assertNewSceneArchive(input: NewSceneArchive): NewSceneArchive {
	const startNodeId = requireNonEmptyString(
		input.startNodeId,
		"场次归档的起始楼层 id",
	);
	const endNodeId = requireNonEmptyString(
		input.endNodeId,
		"场次归档的结束楼层 id",
	);
	if (!isSceneBoundary(input.boundary)) {
		throw new Error(
			`场次归档的结束原因只能是 ${SCENE_BOUNDARIES_TEXT}：${String(input.boundary)}`,
		);
	}
	if (!Number.isInteger(input.floorCount) || input.floorCount < 1) {
		throw new Error("场次归档的楼层数必须是正整数");
	}
	const present = readStringArray(input.present, "场次归档的 present");
	const profiles = assertSceneProfileUpdates(
		input.profiles,
		"场次归档的 profiles",
	);
	const informed = assertSceneInformedList(
		input.informed,
		"场次归档的 informed",
	);
	assertSceneArchiveLinks(present, profiles, informed, "场次归档");
	return {
		endNodeId,
		storyId: requireNonEmptyString(input.storyId, "场次归档的故事 id"),
		startNodeId,
		floorCount: input.floorCount,
		boundary: input.boundary,
		summary: requireNonEmptyString(input.summary, "场次归档的摘要"),
		present,
		profiles,
		informed,
		stateChanges: assertSceneStateChanges(
			input.stateChanges,
			"场次归档的 stateChanges",
		),
		cluesOpened: readStringArray(input.cluesOpened, "场次归档的 cluesOpened"),
		cluesClosed: readStringArray(input.cluesClosed, "场次归档的 cluesClosed"),
	};
}

/**
 * 解析归档输出。线索 id 必须出现在这一场结束时的台账里，标为收了的线索
 * 还必须是已兑现状态；对不上整次拒绝，让任务框架重试。
 */
export function parseSceneArchiveResponse(
	text: string,
	clueSnapshot: unknown,
): ParsedSceneArchive {
	const record = assertPlainObject(
		parseJsonOutputObject(text, "场次归档"),
		"场次归档",
	);
	rejectUnknownKeys(record, RESPONSE_KEYS, "场次归档");
	const summary = requireNonEmptyString(record.summary, "场次归档.summary");
	const present = readStringArray(record.present, "场次归档.present");
	const profiles = assertSceneProfileUpdates(
		record.profiles ?? [],
		"场次归档.profiles",
	);
	const informed = assertSceneInformedList(
		record.informed ?? [],
		"场次归档.informed",
	);
	assertSceneArchiveLinks(present, profiles, informed, "场次归档");
	const stateChanges = assertSceneStateChanges(
		record.stateChanges,
		"场次归档.stateChanges",
	);
	const cluesOpened = readStringArray(
		record.cluesOpened,
		"场次归档.cluesOpened",
	);
	const cluesClosed = readStringArray(
		record.cluesClosed,
		"场次归档.cluesClosed",
	);
	const clues = isJsonObject(clueSnapshot) ? clueSnapshot : {};
	for (const id of cluesOpened) {
		if (!Object.hasOwn(clues, id)) {
			throw new Error(`场次归档.cluesOpened 里的线索在台账里不存在：${id}`);
		}
	}
	for (const id of cluesClosed) {
		const clue = clues[id];
		const status = isJsonObject(clue) ? clue.status : undefined;
		if (!Object.hasOwn(clues, id)) {
			throw new Error(`场次归档.cluesClosed 里的线索在台账里不存在：${id}`);
		}
		if (status !== "fulfilled") {
			throw new Error(`场次归档.cluesClosed 里的线索没有兑现：${id}`);
		}
	}
	return {
		summary,
		present,
		profiles,
		informed,
		stateChanges,
		cluesOpened,
		cluesClosed,
	};
}

export interface SceneArchiveHandlerOptions {
	/** 一场的楼层数上限；默认 12。 */
	readonly maxSceneFloors?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型（settler 角色）。 */
	readonly model?: string;
}

interface PendingScene {
	readonly segment: SceneSegment & {
		readonly endNodeId: string;
		readonly boundary: SceneBoundary;
	};
}

function findSceneNeedingArchive(
	store: StoryStore,
	storyId: string,
	maxSceneFloors: number,
): PendingScene | null {
	const head = store.getHead(storyId);
	if (head === null) return null;
	const scenes = readSceneSegments(store, head.id, maxSceneFloors);
	for (const segment of scenes) {
		if (segment.endNodeId === null || segment.boundary === null) continue;
		const archive = store.getSceneArchive(segment.endNodeId);
		if (archive === null) {
			return {
				segment: {
					...segment,
					endNodeId: segment.endNodeId,
					boundary: segment.boundary,
				},
			};
		}
		const stale =
			archive.startNodeId !== segment.startNodeId ||
			archive.floorCount !== segment.floorIds.length ||
			archive.boundary !== segment.boundary;
		if (stale) {
			return {
				segment: {
					...segment,
					endNodeId: segment.endNodeId,
					boundary: segment.boundary,
				},
			};
		}
	}
	return null;
}

/**
 * 是否还有没归档（或划分已经变化）的已结束场次；当前路径上没有结束时返回
 * false。供故事级后台任务的 needsRun 使用。
 */
export function createSceneArchiveNeedsRun(
	options: SceneArchiveHandlerOptions = {},
): (store: StoryStore, storyId: string) => boolean {
	const maxSceneFloors = assertMaxSceneFloors(
		options.maxSceneFloors ?? DEFAULT_MAX_SCENE_FLOORS,
		"场次归档的楼层数上限",
	);
	return (store, storyId) =>
		findSceneNeedingArchive(store, storyId, maxSceneFloors) !== null;
}

function buildSystemPrompt(): string {
	const shape =
		'{"summary":"…","present":["凛"],"profiles":[{"who":"凛","want":"拿回那封信","hide":null,"speech":"「把书还我。」","unresolved":"信还在老师手里"}],"informed":[{"who":"老师","factId":"a2","via":"told"}],"stateChanges":[{"path":["scene","current","place"],"change":"从教室换到走廊"}],"cluesOpened":["旧信"],"cluesClosed":[]}';
	return [
		"你是故事的档案员。一场戏结束时，你把这一场归档成一条记录。只输出一个 JSON 对象，不要解释、前后缀或代码块标记。",
		shape,
		"- summary：这一场发生了什么、结果如何，写给几章之后的自己看；不要照抄原文，不要写未来会发生的事。",
		"- present：这一场里真正在场的人物名称，用卡里的写法。",
		"- profiles：这一场里档案有变化的人物。who 必须出现在 present 里；want 是他想要什么，hide 是他瞒着什么，speech 是他在这一场里说过的一句话（逐字取原文），unresolved 是尚未了结的事；没有变化的字段写 null，每个字段不超过 500 字。没有档案变化就给空数组。",
		"- informed：这一场里有人被明确告知以前某一场发生的事。who 必须在这一场的 present 里；factId 只能写「之前的场次」列表里的场次 id；via 取 told（当面被告知）或 relayed（听人转述）。没有就给空数组。",
		"- stateChanges：这一场真正改变的硬状态，每条写台账路径与变化内容；没有变化就给空数组。",
		"- cluesOpened：这一场里新开或继续推进的线索 id，只能写台账 clue 命名空间里已经存在的 id。",
		"- cluesClosed：这一场里已经收束的线索 id，必须是台账里状态为 fulfilled 的线索。",
	].join("\n");
}

function buildUserContent(
	store: StoryStore,
	scene: PendingScene,
	floors: readonly {
		readonly id: string;
		readonly role: string;
		readonly raw: string;
	}[],
): string {
	const boundary =
		scene.segment.boundary === "player-ends"
			? "玩家直接结束了这一场"
			: scene.segment.boundary === "scene-ends"
				? "场记判定这一场结束"
				: `达到 ${scene.segment.floorIds.length} 楼上限，强制结束这一场`;
	const lines: string[] = [
		`这一场从楼层 ${scene.segment.startNodeId} 到 ${scene.segment.endNodeId}，共 ${scene.segment.floorIds.length} 个助手楼层（${boundary}）。`,
		"",
		"这一场的原文：",
	];
	for (const node of floors) {
		lines.push(`<楼层 id="${node.id}" 角色="${node.role}">`);
		lines.push(node.raw);
		lines.push("</楼层>");
	}
	const diffs = floors.flatMap((node) => store.getStateDiffs(node.id));
	lines.push("", "这一场写下的台账变更：");
	if (diffs.length === 0) {
		lines.push("没有。");
	} else {
		for (const diff of diffs) {
			const value = diff.op === "set" ? ` = ${JSON.stringify(diff.value)}` : "";
			lines.push(`- ${diff.path.join(".")} ${diff.op}${value}`);
		}
	}
	const clues = readLedger(store, scene.segment.endNodeId, ["clue"]);
	lines.push("", "这一场结束时的线索：");
	lines.push(JSON.stringify(clues ?? {}));
	const priorScenes = store
		.listSceneArchivesAlongPath(scene.segment.endNodeId)
		.filter((archive) => archive.endNodeId !== scene.segment.endNodeId)
		.slice(-PRIOR_SCENE_LIMIT);
	lines.push("", "之前的场次（informed 的 factId 只能从这里取）：");
	if (priorScenes.length === 0) {
		lines.push("没有。");
	} else {
		for (const archive of priorScenes) {
			lines.push(
				`- ${archive.endNodeId}（起于 ${archive.startNodeId}，在场者：${archive.present.join("、")}）：${archive.summary}`,
			);
		}
	}
	return lines.join("\n");
}

/**
 * 场次归档的后台任务：取当前路径上最早一个已结束、还没有归档（或场次划分
 * 已经变化）的场次，一次调用写一条归档；同一场次重跑覆盖同一行。
 */
export function createSceneArchiveHandler(
	options: SceneArchiveHandlerOptions = {},
): BackgroundJobHandler {
	const maxSceneFloors = assertMaxSceneFloors(
		options.maxSceneFloors ?? DEFAULT_MAX_SCENE_FLOORS,
		"场次归档的楼层数上限",
	);
	return async ({ store, client, job, signal }) => {
		const pending = findSceneNeedingArchive(store, job.storyId, maxSceneFloors);
		if (pending === null) return;
		const scene = pending.segment;
		const path = store.getPathToNode(scene.endNodeId);
		const startIndex = path.findIndex((node) => node.id === scene.startNodeId);
		if (startIndex === -1) {
			throw new Error(
				`场次归档的起始楼层 ${scene.startNodeId} 不在楼层 ${scene.endNodeId} 的路径上`,
			);
		}
		const floors = path.slice(startIndex);
		const messages: LlmMessage[] = [
			{ role: "system", content: buildSystemPrompt() },
			{
				role: "user",
				content: buildUserContent(store, pending, floors),
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
		const parsed = parseSceneArchiveResponse(
			result.text,
			readLedger(store, scene.endNodeId, ["clue"]),
		);
		store.saveSceneArchive({
			endNodeId: scene.endNodeId,
			storyId: job.storyId,
			startNodeId: scene.startNodeId,
			floorCount: scene.floorIds.length,
			boundary: scene.boundary,
			summary: parsed.summary,
			present: parsed.present,
			profiles: parsed.profiles,
			informed: parsed.informed,
			stateChanges: parsed.stateChanges,
			cluesOpened: parsed.cluesOpened,
			cluesClosed: parsed.cluesClosed,
		});
	};
}

function readStringArray(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
		const text = item.trim();
		if (seen.has(text)) continue;
		seen.add(text);
		result.push(text);
	}
	return result;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value.trim();
}
