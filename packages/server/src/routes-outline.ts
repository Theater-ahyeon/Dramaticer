// server 路由：大纲（故事蓝图）、AI 建议、导演计划（refactor/06 从 routes.ts 拆出）。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	BLUEPRINT_SUGGESTION_JOB_KIND,
	BLUEPRINT_SUGGESTION_OPERATIONS,
	BLUEPRINT_SUGGESTION_STATUSES,
	type BlueprintDiff,
	type BlueprintSuggestionAcceptance,
	type StoryBlueprintRecord,
	isBlueprintSuggestionOperation,
	isBlueprintSuggestionStatus,
	parseDirectorPlan,
	readBlueprintSuggestionNote,
	readBlueprintView,
	readDirectorPlan,
	readMilestoneDeviation,
	replaceDirectorPlan,
} from "@dramaticer/core";
import type {
	BlueprintSuggestionAcceptResult,
	BlueprintSuggestionRejectResult,
	StoryBlueprintDeviationView,
	StoryBlueprintEditResult,
	StoryBlueprintSuggestionCreateResult,
	StoryBlueprintSuggestionsView,
	StoryBlueprintVersionsView,
	StoryBlueprintView,
	StoryDirectorPlanView,
} from "@dramaticer/protocol";
import { HttpError, sendJson } from "./http.js";
import {
	assertKnownKeys,
	fieldError,
	readObjectBody,
	requireMethod,
	requireStory,
	requireStoryNode,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";

/**
 * `GET /api/stories/:id/blueprint/deviation`：章末里程碑四态；受阻或已不可能
 * 的条目带三个选择。只读派生，不改写蓝图。
 */
export function handleBlueprintDeviation(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const head = options.store.getHead(storyId);
	const view: StoryBlueprintDeviationView = {
		storyId,
		nodeId: head === null ? null : head.id,
		deviations:
			head === null
				? []
				: readMilestoneDeviation(options.store, storyId, head.id),
	};
	sendJson(res, 200, view);
}

/**
 * `GET /api/stories/:id/blueprint`：给玩家看的蓝图。剧透设置为 `hide` 时
 * AI 补的条目只返回条数；`nodeId` 省略时取 head，还没有楼层时返回卡导入的默认蓝图。
 */
export function handleStoryBlueprint(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	url: URL,
): void {
	requireStory(options.store, storyId);
	const raw = url.searchParams.get("nodeId");
	let nodeId: string | null;
	if (raw === null) {
		nodeId = options.store.getHead(storyId)?.id ?? null;
	} else {
		if (raw.length === 0) {
			throw fieldError("nodeId", "nodeId 不能为空");
		}
		requireStoryNode(options.store, storyId, raw);
		nodeId = raw;
	}
	const settings = options.store.getStorySettings(storyId);
	const entries =
		nodeId === null
			? options.store.readStoryBlueprintBaseline(storyId)
			: options.store.readBlueprintEntries(nodeId);
	const blueprint = readBlueprintView(entries, settings.blueprintSpoilers);
	const view: StoryBlueprintView = {
		storyId,
		nodeId,
		spoilers: settings.blueprintSpoilers,
		entries: blueprint.entries,
		hidden: blueprint.hidden,
	};
	sendJson(res, 200, view);
}

/**
 * `POST /api/stories/:id/blueprint/edit`：玩家在大纲页写的修改。请求体带
 * `diffs` 时写一批修改，带 `versionNodeId` 时回到某一版；两者都是有楼层的
 * 记录，省略 `nodeId` 时写在 head 上。锁定的条目对玩家仍然可改。
 */
export async function handleStoryBlueprintEdit(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["nodeId", "diffs", "versionNodeId", "versionSeq"]);
	const head = options.store.getHead(storyId);
	const nodeId =
		body.nodeId === undefined
			? head?.id
			: requireStoryNode(
					options.store,
					storyId,
					requireText(body.nodeId, "nodeId"),
				).id;
	if (nodeId === undefined) {
		throw new HttpError(409, "conflict", "故事还没有楼层，不能改大纲");
	}
	const hasDiffs = body.diffs !== undefined;
	const hasVersion = body.versionNodeId !== undefined;
	if (hasDiffs === hasVersion) {
		throw fieldError("body", "diffs 与 versionNodeId 必须给出其中一个");
	}
	let record: StoryBlueprintRecord;
	if (hasVersion) {
		if (body.versionSeq !== undefined && typeof body.versionSeq !== "number") {
			throw fieldError("versionSeq", "versionSeq 必须是正整数");
		}
		try {
			record = options.store.rollbackStoryBlueprint({
				nodeId,
				storyId,
				versionNodeId: requireText(body.versionNodeId, "versionNodeId"),
				...(body.versionSeq === undefined
					? {}
					: { versionSeq: body.versionSeq }),
			});
		} catch (error) {
			throw toBadRequest(error, "versionNodeId");
		}
	} else {
		if (!Array.isArray(body.diffs)) {
			throw fieldError("diffs", "diffs 必须是数组");
		}
		try {
			record = options.store.saveStoryBlueprint({
				nodeId,
				storyId,
				source: "player",
				diffs: body.diffs as readonly BlueprintDiff[],
			});
		} catch (error) {
			throw toBadRequest(error, "diffs");
		}
	}
	const view: StoryBlueprintEditResult = {
		storyId,
		nodeId,
		record,
		entries: options.store.readBlueprintEntries(nodeId),
	};
	sendJson(res, 200, view);
}

/**
 * `GET /api/stories/:id/blueprint/versions`：当前路径上的修改历史，从旧到新。
 * 故事还没有楼层时没有版本。
 */
export function handleStoryBlueprintVersions(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	url: URL,
): void {
	requireStory(options.store, storyId);
	const raw = url.searchParams.get("nodeId");
	const nodeId =
		raw === null
			? (options.store.getHead(storyId)?.id ?? null)
			: requireStoryNode(options.store, storyId, raw).id;
	const view: StoryBlueprintVersionsView = {
		storyId,
		nodeId,
		versions:
			nodeId === null
				? []
				: options.store.listBlueprintVersions(nodeId).map((version) => ({
						nodeId: version.nodeId,
						seq: version.seq,
						source: version.source,
						createdAt: version.createdAt,
						changes: version.diffs.length,
					})),
	};
	sendJson(res, 200, view);
}

/**
 * `POST /api/stories/:id/blueprint/suggestions` 登记一次建议请求并推进后台
 * 任务；建议在间隙生成，不写蓝图。`GET` 按状态列出建议。
 */
export async function handleBlueprintSuggestions(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	if (method === "GET") {
		const status = url.searchParams.get("status") ?? "pending";
		if (status !== "all" && !isBlueprintSuggestionStatus(status)) {
			throw fieldError(
				"status",
				`status 只能是 all 或 ${BLUEPRINT_SUGGESTION_STATUSES.join("、")}`,
			);
		}
		const view: StoryBlueprintSuggestionsView = {
			storyId,
			status,
			suggestions: options.store.listBlueprintSuggestions(
				status === "all" ? { storyId } : { storyId, status },
			),
		};
		sendJson(res, 200, view);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["operation", "note"]);
	const operation = body.operation;
	if (!isBlueprintSuggestionOperation(operation)) {
		throw fieldError(
			"operation",
			`operation 必须是 ${BLUEPRINT_SUGGESTION_OPERATIONS.join("、")} 之一`,
		);
	}
	let note = "";
	if (body.note !== undefined) {
		try {
			note = readBlueprintSuggestionNote(body.note, "note");
		} catch (error) {
			throw toBadRequest(error, "note");
		}
	}
	const request = options.store.createBlueprintSuggestionRequest({
		storyId,
		operation,
		note,
	});
	const [job] = options.store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [BLUEPRINT_SUGGESTION_JOB_KIND],
	});
	if (job === undefined) {
		throw new Error(`故事 ${storyId} 的蓝图建议任务没有入队`);
	}
	options.scheduler?.schedule(storyId);
	const view: StoryBlueprintSuggestionCreateResult = {
		request,
		jobId: job.id,
	};
	sendJson(res, 201, view);
}

/**
 * `POST /api/blueprint-suggestions/:id/accept|reject`：接受一条建议会在
 * 指定楼层（省略时取 head）追加一批来源为玩家的蓝图修改，并返回更新后的
 * 蓝图；拒绝只改建议状态。已决定的建议返回 409。
 */
export async function handleBlueprintSuggestionDecision(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	idText: string,
	action: "accept" | "reject",
): Promise<void> {
	const id = Number(idText);
	if (!Number.isInteger(id) || id <= 0) {
		throw new HttpError(404, "not_found", `蓝图建议不存在：${idText}`);
	}
	const suggestion = options.store.getBlueprintSuggestion(id);
	if (suggestion === null) {
		throw new HttpError(404, "not_found", `蓝图建议不存在：${id}`);
	}
	if (suggestion.status !== "pending") {
		throw new HttpError(
			409,
			"conflict",
			`蓝图建议 ${id} 已经决定过，状态是 ${suggestion.status}`,
		);
	}
	if (action === "reject") {
		const rejected = options.store.rejectBlueprintSuggestion({ id });
		const view: BlueprintSuggestionRejectResult = { suggestion: rejected };
		sendJson(res, 200, view);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["nodeId"]);
	const nodeId =
		body.nodeId === undefined
			? options.store.getHead(suggestion.storyId)?.id
			: requireText(body.nodeId, "nodeId");
	if (nodeId === undefined) {
		throw new HttpError(409, "conflict", "故事还没有楼层，不能接受蓝图建议");
	}
	const node = options.store.getNode(nodeId);
	if (node === null || node.storyId !== suggestion.storyId) {
		throw fieldError("nodeId", `楼层 ${nodeId} 不属于这个故事`);
	}
	let acceptance: BlueprintSuggestionAcceptance;
	try {
		acceptance = options.store.acceptBlueprintSuggestion({ id, nodeId });
	} catch (error) {
		throw new HttpError(
			409,
			"conflict",
			error instanceof Error ? error.message : String(error),
		);
	}
	const view: BlueprintSuggestionAcceptResult = {
		suggestion: acceptance.suggestion,
		record: acceptance.record,
		blueprint: options.store.readBlueprintEntries(nodeId),
	};
	sendJson(res, 200, view);
}

export async function handleDirectorPlan(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["GET", "PUT"]);
	requireStory(options.store, storyId);
	if (method === "GET") {
		const view: StoryDirectorPlanView = {
			storyId,
			plan: readDirectorPlan(options.store, storyId),
		};
		sendJson(res, 200, view);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["plan"]);
	if (body.plan === undefined) {
		throw fieldError("plan", "更新导演计划必须提供 plan");
	}
	let saved: StoryDirectorPlanView["plan"];
	try {
		replaceDirectorPlan(options.store, storyId, parseDirectorPlan(body.plan));
		saved = readDirectorPlan(options.store, storyId);
	} catch (error) {
		throw toPlanFieldError(error);
	}
	const view: StoryDirectorPlanView = { storyId, plan: saved };
	sendJson(res, 200, view);
}

export function toPlanFieldError(error: unknown): HttpError {
	if (error instanceof HttpError) return error;
	const message = error instanceof Error ? error.message : String(error);
	const first = message.split(" ")[0];
	const path = first?.startsWith("plan") ? first : "plan";
	return fieldError(path, message);
}
