import type { BackgroundJobHandler } from "../background/types.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import type { LlmClient, LlmMessage } from "../llm/types.js";
import { parseJsonOutputObject } from "../memory/json-output.js";
import type { OpeningCandidateRecord } from "../store/settings.js";
import type { StoryStore } from "../store/story-store.js";
import { buildOpeningUserContent, collectOpeningInput } from "./opening.js";

export const OPENING_CANDIDATES_JOB_KIND = "opening_candidates";

/** 一次生成的候选条数：至少 2 条才有比较的意义，最多 3 条控制输出长度。 */
export const MIN_OPENING_CANDIDATE_COUNT = 2;
export const MAX_OPENING_CANDIDATE_COUNT = 3;
export const DEFAULT_OPENING_CANDIDATE_COUNT = 3;

const RESPONSE_FIELDS = ["candidates"] as const;

export function assertOpeningCandidateCount(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < MIN_OPENING_CANDIDATE_COUNT ||
		value > MAX_OPENING_CANDIDATE_COUNT
	) {
		throw new Error(
			`开场候选条数必须是 ${MIN_OPENING_CANDIDATE_COUNT} 到 ${MAX_OPENING_CANDIDATE_COUNT} 之间的整数`,
		);
	}
	return value;
}

/** 校验模型返回的候选批次：未知字段、条数不符与空正文整批拒绝。 */
export function parseOpeningCandidatesResponse(
	text: string,
	expectedCount: number,
): string[] {
	const count = assertOpeningCandidateCount(expectedCount);
	const record = assertPlainObject(
		parseJsonOutputObject(text, "开场候选"),
		"开场候选",
	);
	rejectUnknownKeys(record, RESPONSE_FIELDS, "开场候选");
	const value = record.candidates;
	if (!Array.isArray(value)) {
		throw new Error("开场候选.candidates 必须是数组");
	}
	if (value.length !== count) {
		throw new Error(`开场候选必须是 ${count} 条，实际 ${value.length} 条`);
	}
	return value.map((item, index) => {
		const label = `开场候选.candidates[${index}]`;
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new Error(`${label} 必须是非空字符串`);
		}
		return item.trim();
	});
}

function systemPrompt(count: number): string {
	return [
		"你是故事的开场作者。根据角色卡、世界书常驻设定与玩家的开场白，写出彼此明显不同的开场候选。",
		`- 候选条数：${count} 条。`,
		"- 每个候选是一段完整的助手开场正文，可以直接作为故事的第一个楼层；不要标题、编号、说明或前后缀。",
		"- 候选之间在地点、氛围、第一个冲突或在场人物的行动上要有明显区别。",
		"- 可以按剧情需要写原生块标签，不需要时就不写。",
		"- 只输出一个 JSON 对象，不要解释、前后缀或代码块标记；形如：",
		`{"candidates":${JSON.stringify(
			Array.from({ length: count }, (_, index) => `第${index + 1}个候选的正文`),
		)}}`,
	].join("\n");
}

export interface GenerateOpeningCandidatesOptions {
	readonly store: StoryStore;
	readonly client: LlmClient;
	readonly storyId: string;
	readonly count?: number;
	/** 覆盖客户端默认模型；不设置时使用客户端的默认模型。 */
	readonly model?: string;
	readonly createdAt?: string;
	readonly signal?: AbortSignal;
}

/**
 * 生成一批开场候选并入库。素材不足时抛错；已经存在待选候选也照常追加，
 * 用于显式重新生成。
 */
export async function generateOpeningCandidates(
	options: GenerateOpeningCandidatesOptions,
): Promise<OpeningCandidateRecord[]> {
	const count = assertOpeningCandidateCount(
		options.count ?? DEFAULT_OPENING_CANDIDATE_COUNT,
	);
	const input = collectOpeningInput(options.store, options.storyId);
	if (input === null) {
		throw new Error(
			`故事 ${options.storyId} 没有角色卡或世界书常驻条目，无法生成开场候选`,
		);
	}
	const messages: LlmMessage[] = [
		{ role: "system", content: systemPrompt(count) },
		{ role: "user", content: buildOpeningUserContent(input) },
	];
	const result = await options.client.complete({
		messages,
		model: options.model,
		temperature: 0.9,
		signal: options.signal,
	});
	const raws = parseOpeningCandidatesResponse(result.text, count);
	return options.store.appendOpeningCandidates({
		storyId: options.storyId,
		raws,
		...(options.createdAt === undefined
			? {}
			: { createdAt: options.createdAt }),
	});
}

/**
 * 入队条件为 story 的判定：有素材、故事还没有任何楼层，并且没有待选候选。
 * 选中或重新生成后不再自动建任务；重新生成走 CLI。
 */
export function openingCandidatesNeedRun(
	store: StoryStore,
	storyId: string,
): boolean {
	if (collectOpeningInput(store, storyId) === null) return false;
	if (store.getHead(storyId) !== null) return false;
	return (
		store.listOpeningCandidates(storyId, { status: "pending" }).length === 0
	);
}

export interface OpeningCandidatesHandlerOptions {
	readonly count?: number;
	readonly model?: string;
}

/**
 * 开场候选的后台任务：故事还没有楼层时生成一批候选。已经存在待选候选、
 * 或者玩家已经开了头，就不调用模型。
 */
export function createOpeningCandidatesHandler(
	options: OpeningCandidatesHandlerOptions = {},
): BackgroundJobHandler {
	const count = assertOpeningCandidateCount(
		options.count ?? DEFAULT_OPENING_CANDIDATE_COUNT,
	);
	return async ({ store, client, job, signal }) => {
		if (store.getHead(job.storyId) !== null) return;
		if (
			store.listOpeningCandidates(job.storyId, { status: "pending" }).length > 0
		) {
			return;
		}
		const input = collectOpeningInput(store, job.storyId);
		if (input === null) return;
		await generateOpeningCandidates({
			store,
			client,
			storyId: job.storyId,
			count,
			signal,
			...(options.model === undefined ? {} : { model: options.model }),
		});
	};
}
