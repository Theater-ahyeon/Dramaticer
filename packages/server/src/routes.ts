import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ChooseOpeningCandidateResult,
	type ContextTemplate,
	type ContextTemplateRecord,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	DEFAULT_MEMORY_EVENT_LIMIT,
	DIRECTOR_CONFIG_KEYS,
	LEDGER_CHANGE_CARD_STATUSES,
	MAX_MEMORY_EVENT_LIMIT,
	OPENING_CANDIDATE_STATUSES,
	STORY_SETTINGS_UPDATE_KEYS,
	type StateDiff,
	type Story,
	type StorySettings,
	type StorySettingsUpdate,
	type StoryStore,
	type TimelineNode,
	type UpdateContextTemplateInput,
	fulfillLedgerClue,
	isJsonObject,
	isLedgerChangeCardStatus,
	isOpeningCandidateStatus,
	listLedgerEntities,
	readLedger,
	readLedgerFacts,
} from "@dramaticer/core";
import type {
	CreateContextTemplateRequest,
	CreateStoryRequest,
	FulfillClueResult,
	ImportCharacterCard,
	ImportStoryRequest,
	ImportStoryResult,
	NodeActionResult,
	NodeChoiceResult,
	NodeCompressionsView,
	NodeDirectorView,
	NodeEventsView,
	NodeLedgerView,
	SetHeadRequest,
	StoryCluesView,
	StoryEntitiesView,
	StoryJobErrorView,
	StoryJobsView,
	StoryLoreView,
	StoryOpeningPickResult,
	StoryOpeningsView,
	StoryPath,
	StoryProposalsView,
	StoryTree,
	StoryTreeNode,
	StoryView,
} from "@dramaticer/protocol";
import {
	type ImportedCardContent,
	type StCharacterCard,
	importCardContent,
	parseCharacterCardJson,
	parseCharacterCardPng,
	parseWorldInfoJson,
} from "@dramaticer/st-compat";
import type { BackgroundScheduler } from "./background.js";
import { HttpError, readJsonBody, sendEmpty, sendJson } from "./http.js";
import type { StoryRuntimeManager } from "./runtime.js";
import {
	type TurnCoordinator,
	handleRegenerateStream,
	handleTurnStream,
} from "./turns.js";

export interface ApiRouteOptions {
	readonly store: StoryStore;
	readonly maxJsonBodyBytes: number;
	readonly runtime: StoryRuntimeManager | null;
	readonly turns: TurnCoordinator;
	readonly scheduler?: BackgroundScheduler | null;
	readonly log: (line: string) => void;
	readonly heartbeatMs: number;
	readonly now?: () => number;
}

/** 处理 `/api` 下的故事、导入、设置与模板接口；不认识的路径返回 404。 */
export async function handleApiRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	if (!url.pathname.startsWith("/api/")) {
		throw new HttpError(404, "not_found", "没有这个接口");
	}
	const parts = pathSegments(url.pathname);
	const [first, second, third] = parts;
	if (first === "stories") {
		if (second === undefined) {
			await handleStories(req, res, method, options);
			return;
		}
		const storyId = second;
		if (third === undefined) {
			await handleStory(req, res, method, options, storyId);
			return;
		}
		if (parts.length === 3) {
			switch (third) {
				case "import":
					await handleImport(req, res, method, options, storyId);
					return;
				case "turns":
					requireMethod(method, ["POST"]);
					await handleTurns(req, res, options, storyId);
					return;
				case "settings":
					await handleSettings(req, res, method, options, storyId);
					return;
				case "jobs":
					requireMethod(method, ["GET"]);
					handleJobs(res, options, storyId);
					return;
				case "tree":
					requireMethod(method, ["GET"]);
					handleTree(res, options, storyId);
					return;
				case "path":
					requireMethod(method, ["GET"]);
					handlePath(res, options, url, storyId);
					return;
				case "head":
					requireMethod(method, ["POST"]);
					await handleHead(req, res, options, storyId);
					return;
				case "clues":
					requireMethod(method, ["GET"]);
					handleStoryClues(res, options, storyId);
					return;
				case "entities":
					requireMethod(method, ["GET"]);
					handleEntities(res, options, storyId);
					return;
				case "lore":
					requireMethod(method, ["GET"]);
					handleLore(res, options, storyId);
					return;
				case "proposals":
					requireMethod(method, ["GET"]);
					handleProposals(res, options, url, storyId);
					return;
				case "openings":
					requireMethod(method, ["GET"]);
					handleOpenings(res, options, url, storyId);
					return;
				default:
					break;
			}
		}
		if (
			third === "openings" &&
			parts.length === 5 &&
			parts[4] === "pick" &&
			parts[3] !== undefined
		) {
			requireMethod(method, ["POST"]);
			handleOpeningPick(res, options, storyId, parts[3]);
			return;
		}
	}
	if (first === "nodes" && second !== undefined && parts.length === 3) {
		const nodeId = second;
		switch (third) {
			case "swipe":
				requireMethod(method, ["POST"]);
				await handleNodeText(req, res, options, nodeId, "swipe");
				return;
			case "edit":
				requireMethod(method, ["POST"]);
				await handleNodeText(req, res, options, nodeId, "edit");
				return;
			case "choice":
				requireMethod(method, ["POST"]);
				await handleNodeChoice(req, res, options, nodeId);
				return;
			case "regenerate":
				requireMethod(method, ["POST"]);
				await handleRegenerate(res, options, nodeId);
				return;
			case "trace":
				requireMethod(method, ["GET"]);
				handleNodeTrace(res, options, nodeId);
				return;
			case "ledger":
				requireMethod(method, ["GET"]);
				handleNodeLedger(res, options, nodeId);
				return;
			case "events":
				requireMethod(method, ["GET"]);
				handleNodeEvents(res, options, url, nodeId);
				return;
			case "compressions":
				requireMethod(method, ["GET"]);
				handleNodeCompressions(res, options, nodeId);
				return;
			case "director":
				requireMethod(method, ["GET"]);
				handleNodeDirector(res, options, nodeId);
				return;
			default:
				break;
		}
	}
	if (first === "clues" && second !== undefined && parts.length === 3) {
		if (third === "fulfill") {
			requireMethod(method, ["POST"]);
			await handleClueFulfill(req, res, options, second);
			return;
		}
	}
	if (first === "templates") {
		if (second === undefined) {
			await handleTemplates(req, res, method, options);
			return;
		}
		if (third === undefined) {
			await handleTemplate(req, res, method, options, second);
			return;
		}
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}

async function handleStories(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	requireMethod(method, ["GET", "POST"]);
	if (method === "GET") {
		sendJson(
			res,
			200,
			options.store
				.listStories()
				.map((story) => toStoryView(story, options.store)),
		);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["id", "title"]);
	if (body.id !== undefined) {
		if (typeof body.id !== "string" || body.id.trim().length === 0) {
			throw fieldError("id", "故事 id 必须是非空字符串");
		}
		if (options.store.getStory(body.id) !== null) {
			throw new HttpError(409, "conflict", `故事已存在：${body.id}`, {
				path: "id",
			});
		}
	}
	const request: CreateStoryRequest = {
		...(typeof body.id === "string" ? { id: body.id } : {}),
		title: requireText(body.title, "title"),
	};
	const story = options.store.createStory(request);
	sendJson(res, 201, toStoryView(story, options.store));
}

async function handleStory(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["GET", "PATCH"]);
	const story = requireStory(options.store, storyId);
	if (method === "GET") {
		sendJson(res, 200, toStoryView(story, options.store));
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["title"]);
	if (body.title === undefined) {
		throw fieldError("title", "更新故事至少要提供 title");
	}
	const title = requireText(body.title, "title");
	const saved = options.store.updateStoryTitle(story.id, title);
	sendJson(res, 200, toStoryView(saved, options.store));
}

async function handleImport(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["POST"]);
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["card", "worlds"]);
	const card = parseCardPayload(body.card);
	const worlds = parseWorldPayload(body.worlds);
	const request: ImportStoryRequest = { card, worlds };
	let parsedCard: StCharacterCard;
	try {
		parsedCard =
			request.card.format === "png"
				? parseCharacterCardPng(decodePngBase64(request.card.data))
				: parseCharacterCardJson(request.card.data);
	} catch (error) {
		throw toBadRequest(error, "card");
	}
	const parsedWorlds = request.worlds?.map((text, index) => {
		try {
			return parseWorldInfoJson(text);
		} catch (error) {
			throw toBadRequest(error, `worlds[${index}]`);
		}
	});

	let imported: ImportedCardContent;
	try {
		imported = await options.store.runInTransaction(() => {
			const result = importCardContent(options.store, storyId, {
				card: parsedCard,
				worlds: parsedWorlds,
			});
			options.store.updateStorySettings(storyId, {
				cardName: result.cardName,
				characterPrompt: result.characterPrompt,
			});
			return result;
		});
	} catch (error) {
		throw toBadRequest(error, "card");
	}

	const result: ImportStoryResult = {
		story: toStoryView(requireStory(options.store, storyId), options.store),
		cardName: imported.cardName,
		settings: options.store.getStorySettings(storyId),
		imported: {
			entities: imported.entities,
			lore: imported.lore,
			events: imported.events,
			npcAgendas: imported.npcAgendas,
		},
	};
	sendJson(res, 200, result);
}

async function handleTurns(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	const text = requireText(body.text, "text");
	await handleTurnStream(res, storyId, text, options);
}

function handleJobs(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const counts = options.store.countBackgroundJobs({ storyId });
	const recentErrors: StoryJobErrorView[] = options.store
		.listBackgroundJobs({ storyId })
		.filter((job) => job.lastError !== null)
		.sort((left, right) => {
			const byTime = errorTime(right).localeCompare(errorTime(left));
			return byTime === 0 ? right.id - left.id : byTime;
		})
		.slice(0, 5)
		.map((job) => ({
			jobId: job.id,
			nodeId: job.nodeId,
			kind: job.kind,
			status: job.status,
			attempts: job.attempts,
			error: job.lastError ?? "",
			recordedAt: errorTime(job),
		}));
	const view: StoryJobsView = { storyId, counts, recentErrors };
	sendJson(res, 200, view);
}

function errorTime(job: {
	readonly createdAt: string;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
}): string {
	return job.finishedAt ?? job.startedAt ?? job.createdAt;
}

function handleTree(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const nodes = options.store.listStoryNodes(storyId);
	const childIds = new Map<string, string[]>();
	const roots: string[] = [];
	for (const node of nodes) {
		if (node.parentId === null) {
			roots.push(node.id);
			continue;
		}
		const children = childIds.get(node.parentId);
		if (children === undefined) childIds.set(node.parentId, [node.id]);
		else children.push(node.id);
	}
	const view: StoryTree = {
		storyId,
		headNodeId: options.store.getHead(storyId)?.id ?? null,
		roots,
		nodes: nodes.map(
			(node): StoryTreeNode => ({
				id: node.id,
				parentId: node.parentId,
				role: node.role,
				createdAt: node.createdAt,
				preview: treePreview(node.raw),
				childIds: childIds.get(node.id) ?? [],
			}),
		),
	};
	sendJson(res, 200, view);
}

/** 树里只显示一段可读的开头，完整原文从路径接口按需读取。 */
function treePreview(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, 80);
}

function handlePath(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const nodeId = url.searchParams.get("nodeId");
	const nodes =
		nodeId === null
			? options.store.getPathToHead(storyId)
			: options.store.getPathToNode(
					requireStoryNode(options.store, storyId, nodeId).id,
				);
	sendJson(res, 200, buildPath(options.store, storyId, nodes));
}

async function handleHead(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["nodeId"]);
	const node = requireStoryNode(
		options.store,
		storyId,
		requireText(body.nodeId, "nodeId"),
	);
	options.store.setHead(storyId, node.id);
	sendJson(
		res,
		200,
		buildPath(options.store, storyId, options.store.getPathToNode(node.id)),
	);
}

async function handleNodeText(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
	action: "swipe" | "edit",
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	const text = requireRawText(body.text, "text");
	const created =
		action === "swipe"
			? options.store.swipeNode(node.id, text)
			: options.store.editNode(node.id, text);
	const view: NodeActionResult = {
		node: created,
		path: buildPath(
			options.store,
			created.storyId,
			options.store.getPathToNode(created.id),
		),
	};
	sendJson(res, 201, view);
}

/**
 * 记录一次选项块的选择。界面只发送选中的正文，故事与楼层从节点推出；
 * 载荷校验与非空判断在 `recordPreference` 里完成。
 */
async function handleNodeChoice(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["text"]);
	const text = requireText(body.text, "text");
	const event = options.store.recordPreference({
		storyId: node.storyId,
		nodeId: node.id,
		kind: "choice",
		payload: { choiceText: text },
	});
	const view: NodeChoiceResult = { event };
	sendJson(res, 201, view);
}

async function handleRegenerate(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	if (node.role !== "assistant") {
		throw fieldError("nodeId", `楼层 ${nodeId} 不是助手楼层，不能重新生成`);
	}
	await handleRegenerateStream(res, nodeId, options);
}

function handleNodeTrace(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	requireNode(options.store, nodeId);
	const trace = options.store.getTurnTrace(nodeId);
	if (trace === null) {
		throw new HttpError(404, "not_found", `楼层 ${nodeId} 没有 Trace`);
	}
	sendJson(res, 200, trace);
}

function handleNodeLedger(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeLedgerView = {
		nodeId,
		storyId: node.storyId,
		state: options.store.getStateSnapshot(nodeId).state,
		facts: readLedgerFacts(options.store, nodeId),
		diffs: options.store.getStateDiffs(nodeId),
	};
	sendJson(res, 200, view);
}

function handleNodeEvents(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	nodeId: string,
): void {
	requireNode(options.store, nodeId);
	const limit = queryInteger(url, "limit", 1, MAX_MEMORY_EVENT_LIMIT);
	const offset = queryInteger(url, "offset", 0, Number.MAX_SAFE_INTEGER);
	const view: NodeEventsView = {
		nodeId,
		limit: limit ?? DEFAULT_MEMORY_EVENT_LIMIT,
		offset: offset ?? 0,
		events: options.store.getEventsForPath(nodeId, {
			...(limit === undefined ? {} : { limit }),
			...(offset === undefined ? {} : { offset }),
		}),
	};
	sendJson(res, 200, view);
}

function handleNodeCompressions(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeCompressionsView = {
		nodeId,
		compressions: options.store.getValidSummaries(node.storyId, nodeId),
	};
	sendJson(res, 200, view);
}

function handleNodeDirector(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeDirectorView = {
		nodeId,
		decision: options.store.getDirectorDecision(node.id),
	};
	sendJson(res, 200, view);
}

function handleStoryClues(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const head = options.store.getHead(storyId);
	const view: StoryCluesView = {
		storyId,
		headNodeId: head?.id ?? null,
		clues:
			head === null ? [] : listLedgerEntities(options.store, head.id).openClues,
	};
	sendJson(res, 200, view);
}

async function handleClueFulfill(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	clueId: string,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["storyId"]);
	const storyId = requireText(body.storyId, "storyId");
	requireStory(options.store, storyId);
	const head = options.store.getHead(storyId);
	if (head === null) {
		throw new HttpError(
			409,
			"conflict",
			`故事 ${storyId} 还没有楼层，不能兑现线索`,
		);
	}
	const clue = readLedger(options.store, head.id, ["clue", clueId]);
	if (clue === undefined) {
		throw new HttpError(404, "not_found", `线索不存在：${clueId}`);
	}
	if (isJsonObject(clue) && clue.status === "fulfilled") {
		throw new HttpError(409, "conflict", `线索已经兑现：${clueId}`);
	}
	let diffs: StateDiff[];
	try {
		diffs = await fulfillLedgerClue(options.store, storyId, clueId);
	} catch (error) {
		if (error instanceof Error && error.message.includes("已经兑现")) {
			throw new HttpError(409, "conflict", error.message);
		}
		throw toBadRequest(error, "clueId");
	}
	const view: FulfillClueResult = {
		storyId,
		clueId,
		headNodeId: head.id,
		diffs,
	};
	sendJson(res, 200, view);
}

function handleEntities(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryEntitiesView = {
		storyId,
		entities: options.store.listEntities(storyId),
	};
	sendJson(res, 200, view);
}

function handleLore(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryLoreView = {
		storyId,
		entries: options.store.listLoreEntries(storyId),
	};
	sendJson(res, 200, view);
}

function handleProposals(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const status = url.searchParams.get("status") ?? "pending";
	if (status !== "all" && !isLedgerChangeCardStatus(status)) {
		throw fieldError(
			"status",
			`status 只能是 all 或 ${LEDGER_CHANGE_CARD_STATUSES.join("、")}`,
		);
	}
	const view: StoryProposalsView = {
		storyId,
		status,
		proposals: options.store.listLedgerChangeCards(
			storyId,
			status === "all" ? {} : { status },
		),
	};
	sendJson(res, 200, view);
}

function handleOpenings(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const status = url.searchParams.get("status") ?? "all";
	if (status !== "all" && !isOpeningCandidateStatus(status)) {
		throw fieldError(
			"status",
			`status 只能是 all 或 ${OPENING_CANDIDATE_STATUSES.join("、")}`,
		);
	}
	const view: StoryOpeningsView = {
		storyId,
		status,
		candidates: options.store.listOpeningCandidates(
			storyId,
			status === "all" ? {} : { status },
		),
	};
	sendJson(res, 200, view);
}

function handleOpeningPick(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	candidateId: string,
): void {
	requireStory(options.store, storyId);
	const candidate = options.store.getOpeningCandidate(candidateId);
	if (candidate === null || candidate.storyId !== storyId) {
		throw new HttpError(404, "not_found", `开场候选不存在：${candidateId}`);
	}
	let result: ChooseOpeningCandidateResult;
	try {
		result = options.store.chooseOpeningCandidate(candidateId);
	} catch (error) {
		throw new HttpError(
			409,
			"conflict",
			error instanceof Error ? error.message : String(error),
		);
	}
	const view: StoryOpeningPickResult = {
		candidate: result.candidate,
		node: result.node,
		path: buildPath(
			options.store,
			storyId,
			options.store.getPathToNode(result.node.id),
		),
	};
	sendJson(res, 200, view);
}

function buildPath(
	store: StoryStore,
	storyId: string,
	nodes: readonly TimelineNode[],
): StoryPath {
	return {
		storyId,
		headNodeId: store.getHead(storyId)?.id ?? null,
		nodes: [...nodes],
	};
}

function requireNode(store: StoryStore, nodeId: string): TimelineNode {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
	}
	return node;
}

/** 故事级接口里的节点必须属于路径里的故事，跨故事一律按不存在处理。 */
function requireStoryNode(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): TimelineNode {
	const node = store.getNode(nodeId);
	if (node === null || node.storyId !== storyId) {
		throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
	}
	return node;
}

function queryInteger(
	url: URL,
	name: string,
	min: number,
	max: number,
): number | undefined {
	const raw = url.searchParams.get(name);
	if (raw === null) return undefined;
	if (!/^\d+$/.test(raw)) {
		throw fieldError(name, `${name} 必须是非负整数`);
	}
	const value = Number(raw);
	if (value < min || value > max) {
		throw fieldError(name, `${name} 必须在 ${min} 到 ${max} 之间`);
	}
	return value;
}

async function handleSettings(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["GET", "PUT"]);
	requireStory(options.store, storyId);
	if (method === "GET") {
		sendJson(res, 200, options.store.getStorySettings(storyId));
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, STORY_SETTINGS_UPDATE_KEYS);
	if (Object.keys(body).length === 0) {
		throw fieldError("body", "设置更新至少要包含一个字段");
	}
	const templateId = body.templateId;
	if (
		typeof templateId === "string" &&
		templateId !== DEFAULT_CONTEXT_TEMPLATE_ID &&
		options.store.getContextTemplate(templateId) === null
	) {
		throw fieldError("templateId", `上下文模板不存在：${templateId}`);
	}
	let settings: StorySettings;
	try {
		settings = options.store.updateStorySettings(
			storyId,
			body as StorySettingsUpdate,
		);
	} catch (error) {
		throw toBadRequest(error, inferSettingsPath(error));
	}
	sendJson(res, 200, settings);
}

async function handleTemplates(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	requireMethod(method, ["GET", "POST"]);
	if (method === "GET") {
		sendJson(res, 200, options.store.listContextTemplates());
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["name", "template"]);
	const name = requireText(body.name, "name");
	requireObject(body.template, "template");
	if (
		options.store
			.listContextTemplates()
			.some((template) => template.name === name)
	) {
		throw new HttpError(409, "conflict", `上下文模板名称已存在：${name}`, {
			path: "name",
		});
	}
	const request: CreateContextTemplateRequest = {
		name,
		template: body.template as ContextTemplate,
	};
	let created: ContextTemplateRecord;
	try {
		created = options.store.createContextTemplate(request);
	} catch (error) {
		throw toBadRequest(error, "template");
	}
	sendJson(res, 201, created);
}

async function handleTemplate(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	templateId: string,
): Promise<void> {
	requireMethod(method, ["GET", "PUT", "DELETE"]);
	const current = options.store.getContextTemplate(templateId);
	if (current === null) {
		throw new HttpError(404, "not_found", `上下文模板不存在：${templateId}`);
	}
	if (method === "GET") {
		sendJson(res, 200, current);
		return;
	}
	if (method === "DELETE") {
		const storyId = options.store.findStoryUsingContextTemplate(templateId);
		if (storyId !== null) {
			throw new HttpError(
				409,
				"conflict",
				`上下文模板 ${templateId} 仍被故事 ${storyId} 引用，不能删除`,
				{ storyId },
			);
		}
		options.store.deleteContextTemplate(templateId);
		sendEmpty(res, 204);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["name", "template"]);
	if (body.name === undefined && body.template === undefined) {
		throw fieldError("body", "模板更新至少要提供 name 或 template");
	}
	const name =
		body.name === undefined ? undefined : requireText(body.name, "name");
	if (body.template !== undefined) requireObject(body.template, "template");
	if (name !== undefined && name !== current.name) {
		const existing = options.store
			.listContextTemplates()
			.find((template) => template.name === name && template.id !== templateId);
		if (existing !== undefined) {
			throw new HttpError(409, "conflict", `上下文模板名称已存在：${name}`, {
				path: "name",
			});
		}
	}
	const update: UpdateContextTemplateInput = {
		...(name === undefined ? {} : { name }),
		...(body.template === undefined
			? {}
			: { template: body.template as ContextTemplate }),
	};
	let saved: ContextTemplateRecord;
	try {
		saved = options.store.updateContextTemplate(templateId, update);
	} catch (error) {
		throw toBadRequest(
			error,
			error instanceof Error && error.message.includes("名称")
				? "name"
				: "template",
		);
	}
	sendJson(res, 200, saved);
}

function parseCardPayload(value: unknown): ImportCharacterCard {
	const body = requireObject(value, "card");
	assertKnownKeys(body, ["format", "data"], "card");
	if (body.format !== "png" && body.format !== "json") {
		throw fieldError("card.format", 'card.format 必须是 "png" 或 "json"');
	}
	const data = requireText(body.data, "card.data");
	return body.format === "png"
		? { format: "png", data }
		: { format: "json", data };
}

function parseWorldPayload(value: unknown): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw fieldError("worlds", "worlds 必须是字符串数组");
	}
	return value.map((item, index) => requireText(item, `worlds[${index}]`));
}

function decodePngBase64(data: string): Uint8Array {
	const compact = data.replace(/\s+/g, "");
	if (
		compact.length === 0 ||
		compact.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
	) {
		throw fieldError("card.data", "card.data 不是合法的 base64");
	}
	return new Uint8Array(Buffer.from(compact, "base64"));
}

function toStoryView(story: Story, store: StoryStore): StoryView {
	const head = store.getHead(story.id);
	return {
		id: story.id,
		title: story.title,
		createdAt: story.createdAt,
		headNodeId: head?.id ?? null,
	};
}

function requireStory(store: StoryStore, storyId: string): Story {
	const story = store.getStory(storyId);
	if (story === null) {
		throw new HttpError(404, "not_found", `故事不存在：${storyId}`);
	}
	return story;
}

async function readObjectBody(
	req: IncomingMessage,
	maxJsonBodyBytes: number,
): Promise<Record<string, unknown>> {
	const body = await readJsonBody(req, maxJsonBodyBytes);
	if (!isJsonObject(body)) {
		throw fieldError("body", "请求体必须是 JSON 对象");
	}
	return body as Record<string, unknown>;
}

function assertKnownKeys(
	object: Record<string, unknown>,
	allowed: readonly string[],
	path = "body",
): void {
	for (const key of Object.keys(object)) {
		if (!allowed.includes(key)) {
			throw fieldError(
				path === "body" ? key : `${path}.${key}`,
				`未知字段：${key}`,
			);
		}
	}
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw fieldError(path, `${path} 必须是对象`);
	}
	return value as Record<string, unknown>;
}

function requireText(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw fieldError(path, `${path} 必须是非空字符串`);
	}
	return value.trim();
}

/** 楼层原文可以带首尾空白，只要求去掉空白后不为空。 */
function requireRawText(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw fieldError(path, `${path} 必须是非空字符串`);
	}
	return value;
}

function fieldError(path: string, message: string): HttpError {
	return new HttpError(400, "bad_request", message, { path });
}

function toBadRequest(error: unknown, path: string): HttpError {
	if (error instanceof HttpError) return error;
	const message = error instanceof Error ? error.message : String(error);
	return fieldError(path, message);
}

function inferSettingsPath(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	for (const key of STORY_SETTINGS_UPDATE_KEYS) {
		if (message.includes(key)) return key;
	}
	for (const key of DIRECTOR_CONFIG_KEYS) {
		if (message.includes(key)) return `directorConfig.${key}`;
	}
	return "body";
}

function pathSegments(pathname: string): string[] {
	const body = pathname.slice("/api/".length);
	if (body.length === 0) return [];
	return body.split("/").map((segment) => {
		try {
			return decodeURIComponent(segment);
		} catch {
			throw fieldError("path", "请求路径里的编码不合法");
		}
	});
}

function requireMethod(method: string, allowed: readonly string[]): void {
	if (!allowed.includes(method)) {
		throw new HttpError(405, "bad_request", `不支持的请求方法：${method}`);
	}
}
