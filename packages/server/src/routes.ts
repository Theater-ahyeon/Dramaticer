import { randomUUID } from "node:crypto";
import {
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type ChooseOpeningCandidateResult,
	type ComfyUiSlots,
	type ComfyUiWorkflow,
	type ContextTemplate,
	type ContextTemplateRecord,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	DEFAULT_MEMORY_EVENT_LIMIT,
	DIRECTOR_CONFIG_KEYS,
	type DirectorDecision,
	type DirectorIntensity,
	type ImagePromptRequest,
	ImageWorkflowInUseError,
	type ImagesConfig,
	LEDGER_CHANGE_CARD_STATUSES,
	LLM_MODEL_ROLE_NAMES,
	type LedgerChangeCard,
	LedgerChangeCardError,
	type LlmChannel,
	type LlmChannelApi,
	type LlmChannelConfig,
	type LlmChannelsConfig,
	type LlmModelProbe,
	type LlmModelRole,
	MAX_MEMORY_EVENT_LIMIT,
	type NodeImageRecord,
	OPENING_CANDIDATES_JOB_KIND,
	OPENING_CANDIDATE_STATUSES,
	STORY_SETTINGS_UPDATE_KEYS,
	type StateDiff,
	type Story,
	type StorySettings,
	type StorySettingsUpdate,
	type StoryStore,
	type TimelineNode,
	type TurnMode,
	type UpdateContextTemplateInput,
	VISUAL_PROFILE_JOB_KIND,
	applyChannelsUpdate,
	approveLedgerChangeCard,
	assertComfyUiSlots,
	assertDirectorIntensity,
	createBlockFormatSegment,
	createDefaultContextTemplate,
	detectComfyUiSlots,
	emptyImagesConfig,
	enqueueIllustrateBackgroundJob,
	enqueueOpeningBackgroundJobs,
	enqueueVisualProfileBackgroundJob,
	fulfillLedgerClue,
	isJsonObject,
	isLedgerChangeCardStatus,
	isOpeningCandidateStatus,
	isTurnMode,
	listLedgerEntities,
	loadImagesConfig,
	parseChannelsConfig,
	parseComfyUiWorkflow,
	parseDirectorPlan,
	probeChannel,
	readChannelsKeyRefs,
	readDirectorPlan,
	readLedger,
	readLedgerFacts,
	rejectLedgerChangeCard,
	replaceDirectorPlan,
	resolveImageProvider,
	resolveModelForRole,
	rollbackLedgerChangeCard,
	setModelProbeInText,
	validateImagePromptRequest,
	validateRoleModelFamilies,
} from "@dramaticer/core";
import {
	type ChannelProbeResult,
	type ChannelUpdateInput,
	type ChannelsUpdateRequest,
	type ChannelsView,
	type CreateContextTemplateRequest,
	type CreateStoryRequest,
	type DirectorDecisionView,
	type EmbeddingUpdateInput,
	type FulfillClueResult,
	type ImageProvidersView,
	type ImageWorkflowDetectionView,
	type ImageWorkflowsView,
	type ImportCharacterCard,
	type ImportStoryRequest,
	type ImportStoryResult,
	type ModelUpdateInput,
	type NodeActionResult,
	type NodeActionsView,
	type NodeChoiceResult,
	type NodeCompressionsView,
	type NodeDirectorView,
	type NodeEventsView,
	type NodeImage,
	type NodeImagesView,
	type NodeLedgerView,
	type ProposalDecisionAction,
	type ProposalDecisionResult,
	type SetHeadRequest,
	type StoryCluesView,
	type StoryDirectorPlanView,
	type StoryEntitiesView,
	type StoryJobErrorView,
	type StoryJobsView,
	type StoryLoreView,
	type StoryOpeningGenerateResult,
	type StoryOpeningPickResult,
	type StoryOpeningsView,
	type StoryPath,
	type StoryProposalsView,
	type StoryTemplateView,
	type StoryTree,
	type StoryTreeNode,
	type StoryView,
	type StoryVisualProfileGenerateResult,
	type StoryVisualProfilesView,
	isProposalDecisionAction,
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
	/** 渠道配置文件的路径；没有配置时管理接口返回 404。 */
	readonly channelsPath: string | null;
	readonly channelsEnv: Readonly<Record<string, string | undefined>>;
	/** 生图配置文件的路径；没有配置时 provider 列表为空。 */
	readonly imagesPath: string | null;
	readonly imagesEnv: Readonly<Record<string, string | undefined>>;
	readonly imagesConfig: ImagesConfig;
	/** 生成文件目录；媒体接口只在这里读取。 */
	readonly imagesMediaDir: string;
	/** 渠道体检用；测试注入假通道。 */
	readonly createChannel: (config: LlmChannelConfig) => LlmChannel;
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
				case "template":
					requireMethod(method, ["GET"]);
					handleStoryTemplate(res, options, storyId);
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
				case "visual-profiles":
					requireMethod(method, ["GET"]);
					handleStoryVisualProfiles(res, options, storyId);
					return;
				default:
					break;
			}
		}
		if (third === "openings" && parts.length === 4 && parts[3] === "generate") {
			requireMethod(method, ["POST"]);
			handleOpeningGenerate(res, options, storyId);
			return;
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
		if (
			third === "visual-profiles" &&
			parts.length === 4 &&
			parts[3] === "generate"
		) {
			requireMethod(method, ["POST"]);
			handleStoryVisualProfilesGenerate(res, options, storyId);
			return;
		}
		if (third === "director" && parts.length === 4 && parts[3] === "plan") {
			await handleDirectorPlan(req, res, method, options, storyId);
			return;
		}
	}
	if (first === "channels") {
		if (second === undefined && parts.length === 1) {
			await handleChannels(req, res, method, options);
			return;
		}
		if (second === "probe" && parts.length === 2) {
			requireMethod(method, ["POST"]);
			await handleChannelProbe(req, res, options);
			return;
		}
	}
	if (first === "images") {
		if (second === "providers" && parts.length === 2) {
			requireMethod(method, ["GET"]);
			await handleImageProviders(res, options);
			return;
		}
		if (second === "workflows") {
			if (parts.length === 2) {
				requireMethod(method, ["GET"]);
				handleImageWorkflows(res, options);
				return;
			}
			if (parts.length === 3 && third === "detect") {
				requireMethod(method, ["POST"]);
				await handleImageWorkflowDetect(req, res, options);
				return;
			}
			if (parts.length === 3 && third === "import") {
				requireMethod(method, ["POST"]);
				await handleImageWorkflowImport(req, res, options);
				return;
			}
			if (parts.length === 3) {
				requireMethod(method, ["DELETE"]);
				handleImageWorkflowDelete(res, options, third);
				return;
			}
		}
		if (parts.length === 3 && third === "retry") {
			requireMethod(method, ["POST"]);
			handleImageRetry(res, options, second);
			return;
		}
		if (parts.length === 3 && third === "file") {
			requireMethod(method, ["GET"]);
			await handleImageFile(res, options, second);
			return;
		}
	}
	if (first === "proposals" && second !== undefined && parts.length === 3) {
		const action = third;
		if (isProposalDecisionAction(action)) {
			requireMethod(method, ["POST"]);
			await handleProposalDecision(res, options, second, action);
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
			case "actions":
				requireMethod(method, ["GET"]);
				handleNodeActions(res, options, nodeId);
				return;
			case "images":
				requireMethod(method, ["GET", "POST"]);
				if (method === "GET") {
					handleNodeImageList(res, options, nodeId);
					return;
				}
				await handleNodeImages(req, res, options, nodeId);
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
	enqueueOpeningBackgroundJobs(options.store, story.id);
	enqueueVisualProfileBackgroundJob(options.store, story.id);
	options.scheduler?.schedule(story.id);
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

	enqueueOpeningBackgroundJobs(options.store, storyId);
	enqueueVisualProfileBackgroundJob(options.store, storyId);
	options.scheduler?.schedule(storyId);
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
	assertKnownKeys(body, ["text", "mode", "intensity"]);
	const text = requireText(body.text, "text");
	await handleTurnStream(res, storyId, text, options, {
		directorIntensity: readOptionalIntensity(body.intensity),
		turnMode: readOptionalMode(body.mode),
	});
}

function readOptionalMode(value: unknown): TurnMode | null {
	if (value === undefined) return null;
	if (!isTurnMode(value)) {
		throw fieldError("mode", "回合的 mode 只接受 fast 或 deep");
	}
	return value;
}

function readOptionalIntensity(value: unknown): DirectorIntensity | null {
	if (value === undefined) return null;
	try {
		return assertDirectorIntensity(value, "回合的 intensity");
	} catch (error) {
		throw fieldError(
			"intensity",
			error instanceof Error ? error.message : "回合的 intensity 不合法",
		);
	}
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

const PATH_DEFAULT_LIMIT = 60;
const PATH_MAX_LIMIT = 200;

/**
 * 路径接口按页读取：`nodeId` 是锚点，缺省 head；只裁掉更早的楼层，
 * `before` 指向上一页最早那层，取它之前的一页。
 */
function handlePath(
	res: ServerResponse,
	options: ApiRouteOptions,
	url: URL,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const limit =
		queryInteger(url, "limit", 1, PATH_MAX_LIMIT) ?? PATH_DEFAULT_LIMIT;
	const nodeId = url.searchParams.get("nodeId");
	const anchor =
		nodeId === null
			? options.store.getPathToHead(storyId)
			: options.store.getPathToNode(
					requireStoryNode(options.store, storyId, nodeId).id,
				);
	const before = url.searchParams.get("before");
	let pageEnd = anchor.length;
	if (before !== null) {
		const beforeNode = requireStoryNode(options.store, storyId, before);
		const index = anchor.findIndex((node) => node.id === beforeNode.id);
		if (index < 0) {
			throw new HttpError(
				404,
				"not_found",
				`楼层节点不在锚点路径上：${before}`,
			);
		}
		pageEnd = index;
	}
	const pageStart = Math.max(0, pageEnd - limit);
	const view: StoryPath = {
		storyId,
		headNodeId: options.store.getHead(storyId)?.id ?? null,
		nodes: toPathNodes(options.store, anchor.slice(pageStart, pageEnd)),
		hasMore: pageStart > 0,
	};
	sendJson(res, 200, view);
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
	sendJson(res, 200, buildNodeLedgerView(options.store, nodeId));
}

function buildNodeLedgerView(
	store: StoryStore,
	nodeId: string,
): NodeLedgerView {
	const node = requireNode(store, nodeId);
	return {
		nodeId,
		storyId: node.storyId,
		state: store.getStateSnapshot(nodeId).state,
		facts: readLedgerFacts(store, nodeId),
		diffs: store.getStateDiffs(nodeId),
	};
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
	const mode = options.store.getStorySettings(node.storyId).directorConfig.mode;
	const decision = options.store.getDirectorDecision(node.id);
	const view: NodeDirectorView = {
		nodeId: node.id,
		mode,
		decision:
			decision === null
				? null
				: mode === "blind"
					? redactDirectorDecision(decision)
					: decision,
	};
	sendJson(res, 200, view);
}

/** 该楼层在间隙里生成的候选行动；没有时返回空数组。 */
function handleNodeActions(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeActionsView = {
		nodeId: node.id,
		actions: options.store.listDirectorCandidateActions(node.id),
	};
	sendJson(res, 200, view);
}

/** 盲盒模式下面向玩家只保留机制触发状态，隐去指令与信号。 */
function redactDirectorDecision(
	decision: DirectorDecision,
): DirectorDecisionView {
	return {
		nodeId: decision.nodeId,
		storyId: decision.storyId,
		directive: null,
		mechanisms: decision.mechanisms,
		createdAt: decision.createdAt,
	};
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

async function handleProposalDecision(
	res: ServerResponse,
	options: ApiRouteOptions,
	cardId: string,
	action: ProposalDecisionAction,
): Promise<void> {
	let card: LedgerChangeCard;
	try {
		card = await decideLedgerChangeCard(options.store, cardId, action);
	} catch (error) {
		throw toProposalDecisionError(error);
	}
	const head = options.store.getHead(card.storyId);
	const view: ProposalDecisionResult = {
		card,
		ledger: head === null ? null : buildNodeLedgerView(options.store, head.id),
	};
	sendJson(res, 200, view);
}

function decideLedgerChangeCard(
	store: StoryStore,
	cardId: string,
	action: ProposalDecisionAction,
): Promise<LedgerChangeCard> {
	switch (action) {
		case "approve":
			return approveLedgerChangeCard(store, cardId);
		case "reject":
			return rejectLedgerChangeCard(store, cardId);
		case "rollback":
			return rollbackLedgerChangeCard(store, cardId);
	}
}

/** 卡片不存在映射 404，状态不允许映射 409；其余错误原样上抛。 */
function toProposalDecisionError(error: unknown): HttpError {
	if (!(error instanceof LedgerChangeCardError)) throw error;
	if (error.code === "not_found") {
		return new HttpError(404, "not_found", error.message);
	}
	return new HttpError(409, "conflict", error.message);
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

function handleStoryVisualProfiles(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: StoryVisualProfilesView = {
		storyId,
		profiles: options.store.listCharacterVisualProfiles(storyId),
	};
	sendJson(res, 200, view);
}

function handleStoryVisualProfilesGenerate(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const [job] = options.store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [VISUAL_PROFILE_JOB_KIND],
	});
	if (job === undefined) {
		throw new Error(`故事 ${storyId} 的视觉档案任务没有入队`);
	}
	options.scheduler?.schedule(storyId);
	const view: StoryVisualProfileGenerateResult = {
		storyId,
		jobId: job.id,
		kind: job.kind,
	};
	sendJson(res, 202, view);
}

function handleOpeningGenerate(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	if (options.store.getHead(storyId) !== null) {
		throw new HttpError(
			409,
			"conflict",
			`故事 ${storyId} 已经有楼层，不能再重新生成开场候选`,
		);
	}
	const [job] = options.store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [OPENING_CANDIDATES_JOB_KIND],
	});
	if (job === undefined) {
		throw new Error(`故事 ${storyId} 的开场候选任务没有入队`);
	}
	options.scheduler?.schedule(storyId);
	const view: StoryOpeningGenerateResult = {
		storyId,
		jobId: job.id,
		kind: job.kind,
	};
	sendJson(res, 202, view);
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

async function handleDirectorPlan(
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

function toPlanFieldError(error: unknown): HttpError {
	if (error instanceof HttpError) return error;
	const message = error instanceof Error ? error.message : String(error);
	const first = message.split(" ")[0];
	const path = first?.startsWith("plan") ? first : "plan";
	return fieldError(path, message);
}

function buildPath(
	store: StoryStore,
	storyId: string,
	nodes: readonly TimelineNode[],
): StoryPath {
	return {
		storyId,
		headNodeId: store.getHead(storyId)?.id ?? null,
		nodes: toPathNodes(store, nodes),
		hasMore: false,
	};
}

/** 路径楼层带上附属图片；一次查询覆盖整页，图片按 `ordinal` 排序。 */
function toPathNodes(
	store: StoryStore,
	nodes: readonly TimelineNode[],
): StoryPath["nodes"] {
	const grouped = new Map<string, NodeImage[]>();
	for (const record of store.listNodeImagesForNodes(
		nodes.map((node) => node.id),
	)) {
		const list = grouped.get(record.nodeId);
		const view = toNodeImage(record);
		if (list === undefined) grouped.set(record.nodeId, [view]);
		else list.push(view);
	}
	return nodes.map((node) => ({
		...node,
		images: grouped.get(node.id) ?? [],
	}));
}

function toNodeImage(record: NodeImageRecord): NodeImage {
	return {
		id: record.id,
		nodeId: record.nodeId,
		ordinal: record.ordinal,
		status: record.status,
		url:
			record.status === "done"
				? `/api/images/${encodeURIComponent(record.id)}/file`
				: null,
		width: record.width,
		height: record.height,
		error: record.error,
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

async function handleChannels(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
): Promise<void> {
	requireMethod(method, ["GET", "PUT"]);
	if (options.channelsPath === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置渠道文件，渠道管理接口不可用",
		);
	}
	const filePath = options.channelsPath;
	if (method === "GET") {
		const text = await readChannelsText(filePath);
		const config = parseChannelsText(text, options, filePath);
		sendJson(res, 200, buildChannelsView(text, config, options));
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	const update = readChannelsUpdate(body, options.channelsEnv);
	const text = await readChannelsText(filePath);
	let candidate: string;
	try {
		candidate = applyChannelsUpdate(text, update, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
	const config = parseChannelsText(candidate, options, filePath);
	assertChannelsUsable(config);
	await writeChannelsText(filePath, candidate);
	sendJson(res, 200, buildChannelsView(candidate, config, options));
}

async function handleChannelProbe(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	if (options.channelsPath === null) {
		throw new HttpError(
			404,
			"not_found",
			"服务没有配置渠道文件，渠道管理接口不可用",
		);
	}
	const filePath = options.channelsPath;
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["alias", "channel"]);
	const alias = requireText(body.alias, "alias");
	const text = await readChannelsText(filePath);
	const config = parseChannelsText(text, options, filePath);
	const model = config.models.get(alias);
	if (model === undefined) {
		throw fieldError("alias", `没有模型 ${alias}`);
	}
	const channelId =
		body.channel === undefined
			? model.channels[0]
			: requireText(body.channel, "channel");
	if (channelId === undefined) {
		throw fieldError("channel", `模型 ${alias} 没有配置渠道`);
	}
	if (!model.channels.includes(channelId)) {
		throw fieldError("channel", `模型 ${alias} 没有配置渠道 ${channelId}`);
	}
	const channelConfig = config.channels.get(channelId);
	if (channelConfig === undefined) {
		throw fieldError("channel", `没有渠道 ${channelId}`);
	}
	let probe: LlmModelProbe;
	try {
		probe = await probeChannel({
			channel: options.createChannel(channelConfig),
			model: {
				id: model.id,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
			},
			...(options.now === undefined ? {} : { now: options.now }),
		});
	} catch (error) {
		throw new HttpError(
			400,
			"bad_request",
			`渠道体检失败：${error instanceof Error ? error.message : String(error)}`,
			{ path: "alias" },
		);
	}
	let candidate: string;
	try {
		candidate = setModelProbeInText(text, alias, probe, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
	await writeChannelsText(filePath, candidate);
	const result: ChannelProbeResult = { alias, channel: channelId, probe };
	sendJson(res, 200, result);
}

async function readChannelsText(filePath: string): Promise<string> {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		throw new HttpError(
			400,
			"bad_request",
			`读取渠道配置失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function writeChannelsText(
	filePath: string,
	text: string,
): Promise<void> {
	const tempPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(tempPath, text, "utf8");
		await rename(tempPath, filePath);
	} catch (error) {
		await rm(tempPath, { force: true }).catch(() => undefined);
		throw new HttpError(
			500,
			"internal",
			`写入渠道配置失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function parseChannelsText(
	text: string,
	options: ApiRouteOptions,
	filePath: string,
): LlmChannelsConfig {
	try {
		return parseChannelsConfig(text, options.channelsEnv, filePath);
	} catch (error) {
		throw configError(error, filePath);
	}
}

function assertChannelsUsable(config: LlmChannelsConfig): void {
	try {
		validateRoleModelFamilies(config);
	} catch (error) {
		throw new HttpError(
			400,
			"bad_request",
			error instanceof Error ? error.message : String(error),
			{ path: "roles.judge", roles: ["judge", "writer"] },
		);
	}
	for (const role of LLM_MODEL_ROLE_NAMES) {
		try {
			resolveModelForRole(config, role);
		} catch (error) {
			throw fieldError(
				`roles.${role}`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}

function configError(error: unknown, filePath: string): HttpError {
	if (error instanceof HttpError) return error;
	const message = error instanceof Error ? error.message : String(error);
	const prefix = `${filePath}.`;
	if (!message.startsWith(prefix)) {
		return new HttpError(400, "bad_request", message);
	}
	const match = /^\S+/.exec(message.slice(prefix.length));
	if (match === null) {
		return new HttpError(400, "bad_request", message);
	}
	return fieldError(match[0], message);
}

function buildChannelsView(
	text: string,
	config: LlmChannelsConfig,
	options: ApiRouteOptions,
): ChannelsView {
	const refs = readChannelsKeyRefs(
		text,
		options.channelsPath ?? "channels.yaml",
	);
	const env = options.channelsEnv;
	return {
		channels: [...config.channels.values()].map((channel) => {
			const envName = refs.channels.get(channel.id) ?? null;
			return {
				id: channel.id,
				api: channel.api,
				baseUrl: channel.baseUrl,
				apiKeyEnv: envName,
				apiKeySet: envName === null ? true : (env[envName] ?? "").length > 0,
				requestsPerMinute: channel.requestsPerMinute,
				maxRetries: channel.maxRetries,
				retryBaseDelayMs: channel.retryBaseDelayMs,
				timeoutMs: channel.timeoutMs,
			};
		}),
		models: [...config.models.values()].map((model) => ({
			alias: model.alias,
			id: model.id,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			reasoning: model.reasoning,
			enabled: model.enabled,
			channels: [...model.channels],
			probe: model.probe,
		})),
		embeddings: [...config.embeddings.values()].map((embedding) => {
			const envName = refs.embeddings.get(embedding.id) ?? null;
			return {
				id: embedding.id,
				api: embedding.api,
				baseUrl: embedding.baseUrl,
				apiKeyEnv: envName,
				apiKeySet: envName === null ? true : (env[envName] ?? "").length > 0,
				model: embedding.model,
				dimensions: embedding.dimensions,
				batchSize: embedding.batchSize,
				requestsPerMinute: embedding.requestsPerMinute,
				maxRetries: embedding.maxRetries,
				retryBaseDelayMs: embedding.retryBaseDelayMs,
				timeoutMs: embedding.timeoutMs,
			};
		}),
		roles: Object.fromEntries(
			LLM_MODEL_ROLE_NAMES.map((role) => {
				try {
					return [role, resolveModelForRole(config, role)];
				} catch {
					return [role, config.roles.get(role) ?? null];
				}
			}),
		) as Record<LlmModelRole, string | null>,
		configuredRoles: Object.fromEntries(config.roles.entries()) as Partial<
			Record<LlmModelRole, string>
		>,
	};
}

const CHANNEL_UPDATE_KEYS = [
	"api",
	"baseUrl",
	"apiKeyEnv",
	"requestsPerMinute",
	"maxRetries",
	"retryBaseDelayMs",
	"timeoutMs",
] as const;

const MODEL_UPDATE_KEYS = [
	"id",
	"contextWindow",
	"maxTokens",
	"reasoning",
	"enabled",
	"channels",
] as const;

const EMBEDDING_UPDATE_KEYS = [
	"api",
	"baseUrl",
	"apiKeyEnv",
	"model",
	"dimensions",
	"batchSize",
	"requestsPerMinute",
	"maxRetries",
	"retryBaseDelayMs",
	"timeoutMs",
] as const;

function readChannelsUpdate(
	body: Record<string, unknown>,
	env: Readonly<Record<string, string | undefined>>,
): ChannelsUpdateRequest {
	assertKnownKeys(body, ["channels", "models", "embeddings", "roles"]);
	const channels = readUpdateSection(body.channels, "channels", (value, path) =>
		readChannelUpdate(value, path, env),
	);
	const models = readUpdateSection(body.models, "models", (value, path) =>
		readModelUpdate(value, path, env),
	);
	const embeddings = readUpdateSection(
		body.embeddings,
		"embeddings",
		(value, path) => readEmbeddingUpdate(value, path, env),
	);
	const roles = readRolesUpdate(body.roles, models);
	for (const [alias, model] of Object.entries(models)) {
		const seen = new Set<string>();
		for (const channelId of model.channels) {
			if (!(channelId in channels)) {
				throw fieldError(
					`models.${alias}.channels`,
					`模型 ${alias} 引用了不存在的渠道 ${channelId}`,
				);
			}
			if (seen.has(channelId)) {
				throw fieldError(
					`models.${alias}.channels`,
					`模型 ${alias} 重复引用了渠道 ${channelId}`,
				);
			}
			seen.add(channelId);
		}
	}
	return { channels, models, embeddings, roles };
}

function readUpdateSection<T>(
	value: unknown,
	path: string,
	readEntry: (value: unknown, path: string) => T,
): Record<string, T> {
	const raw = requireObject(value, path);
	const result: Record<string, T> = {};
	for (const [id, entry] of Object.entries(raw)) {
		if (id.trim().length === 0) {
			throw fieldError(path, `${path} 里的名字不能为空`);
		}
		result[id] = readEntry(entry, `${path}.${id}`);
	}
	return result;
}

function readChannelUpdate(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): ChannelUpdateInput {
	const raw = requireObject(value, path);
	assertKnownKeys(raw, CHANNEL_UPDATE_KEYS, path);
	const api = raw.api;
	if (
		api !== "openai-completions" &&
		api !== "google-generative-ai" &&
		api !== "google-vertex"
	) {
		throw fieldError(
			`${path}.api`,
			`${path}.api 只能是 openai-completions、google-generative-ai 或 google-vertex`,
		);
	}
	return {
		api,
		baseUrl: requireEnvText(raw.baseUrl, `${path}.baseUrl`, env),
		apiKeyEnv: readEnvName(raw.apiKeyEnv, `${path}.apiKeyEnv`, env),
		requestsPerMinute: requireInteger(
			raw.requestsPerMinute,
			`${path}.requestsPerMinute`,
			0,
		),
		maxRetries: requireInteger(raw.maxRetries, `${path}.maxRetries`, 0),
		retryBaseDelayMs: requireInteger(
			raw.retryBaseDelayMs,
			`${path}.retryBaseDelayMs`,
			0,
		),
		timeoutMs: requireInteger(raw.timeoutMs, `${path}.timeoutMs`, 1),
	};
}

function readModelUpdate(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): ModelUpdateInput {
	const raw = requireObject(value, path);
	assertKnownKeys(raw, MODEL_UPDATE_KEYS, path);
	const rawChannels = raw.channels;
	if (!Array.isArray(rawChannels) || rawChannels.length === 0) {
		throw fieldError(`${path}.channels`, `${path}.channels 必须是非空数组`);
	}
	const channels: string[] = [];
	for (const item of rawChannels) {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw fieldError(`${path}.channels`, `${path}.channels 里只能写渠道 id`);
		}
		channels.push(item.trim());
	}
	const reasoning = raw.reasoning;
	if (typeof reasoning !== "boolean") {
		throw fieldError(`${path}.reasoning`, `${path}.reasoning 必须是布尔值`);
	}
	const enabled = raw.enabled;
	if (typeof enabled !== "boolean") {
		throw fieldError(`${path}.enabled`, `${path}.enabled 必须是布尔值`);
	}
	return {
		id: requireEnvText(raw.id, `${path}.id`, env),
		contextWindow: requireInteger(
			raw.contextWindow,
			`${path}.contextWindow`,
			1,
		),
		maxTokens: requireInteger(raw.maxTokens, `${path}.maxTokens`, 1),
		reasoning,
		enabled,
		channels,
	};
}

function readEmbeddingUpdate(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): EmbeddingUpdateInput {
	const raw = requireObject(value, path);
	assertKnownKeys(raw, EMBEDDING_UPDATE_KEYS, path);
	if (raw.api !== "openai-embeddings") {
		throw fieldError(`${path}.api`, `${path}.api 只能是 openai-embeddings`);
	}
	return {
		api: "openai-embeddings",
		baseUrl: requireEnvText(raw.baseUrl, `${path}.baseUrl`, env),
		apiKeyEnv: readEnvName(raw.apiKeyEnv, `${path}.apiKeyEnv`, env),
		model: requireEnvText(raw.model, `${path}.model`, env),
		dimensions: requireInteger(raw.dimensions, `${path}.dimensions`, 1),
		batchSize: requireInteger(raw.batchSize, `${path}.batchSize`, 1),
		requestsPerMinute: requireInteger(
			raw.requestsPerMinute,
			`${path}.requestsPerMinute`,
			0,
		),
		maxRetries: requireInteger(raw.maxRetries, `${path}.maxRetries`, 0),
		retryBaseDelayMs: requireInteger(
			raw.retryBaseDelayMs,
			`${path}.retryBaseDelayMs`,
			0,
		),
		timeoutMs: requireInteger(raw.timeoutMs, `${path}.timeoutMs`, 1),
	};
}

function readRolesUpdate(
	value: unknown,
	models: Readonly<Record<string, ModelUpdateInput>>,
): Readonly<Partial<Record<LlmModelRole, string>>> {
	const raw = value === undefined ? {} : requireObject(value, "roles");
	const roles: Partial<Record<LlmModelRole, string>> = {};
	for (const [name, aliasValue] of Object.entries(raw)) {
		if (!(LLM_MODEL_ROLE_NAMES as readonly string[]).includes(name)) {
			throw fieldError(
				`roles.${name}`,
				`roles.${name} 不是已知角色，只能是 ${LLM_MODEL_ROLE_NAMES.join("、")}`,
			);
		}
		const alias = requireText(aliasValue, `roles.${name}`);
		const model = models[alias];
		if (model === undefined) {
			throw fieldError(
				`roles.${name}`,
				`roles.${name} 引用了不存在的模型 ${alias}`,
			);
		}
		if (!model.enabled) {
			throw fieldError(
				`roles.${name}`,
				`roles.${name} 指向的模型 ${alias} 已经被停用`,
			);
		}
		roles[name as LlmModelRole] = alias;
	}
	return roles;
}

function readEnvName(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): string {
	if (typeof value !== "string") {
		throw fieldError(path, `${path} 必须是字符串`);
	}
	const name = value.trim();
	if (name.length === 0) return "";
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		throw fieldError(path, `${path} 只接受环境变量名，不接受密钥值`);
	}
	if (env[name] === undefined) {
		throw fieldError(path, `${path} 引用的环境变量 ${name} 没有设置`);
	}
	return name;
}

function requireEnvText(
	value: unknown,
	path: string,
	env: Readonly<Record<string, string | undefined>>,
): string {
	const text = requireText(value, path);
	for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
		const name = match[1] as string;
		if (env[name] === undefined) {
			throw fieldError(path, `${path} 引用的环境变量 ${name} 没有设置`);
		}
	}
	return text;
}

function requireInteger(value: unknown, path: string, minimum: number): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum
	) {
		throw fieldError(path, `${path} 必须是不小于 ${minimum} 的整数`);
	}
	return value;
}

async function handleImageProviders(
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const config =
		options.imagesPath === null
			? emptyImagesConfig()
			: await loadImagesConfig(options.imagesPath, options.imagesEnv);
	const view: ImageProvidersView = {
		providers: [...config.providers.values()].map((provider) => ({
			id: provider.id,
			api: provider.api,
			baseUrl: provider.baseUrl,
			configured: true,
			timeoutMs: provider.timeoutMs,
			pollIntervalMs: provider.pollIntervalMs,
		})),
	};
	sendJson(res, 200, view);
}

function handleImageWorkflows(
	res: ServerResponse,
	options: ApiRouteOptions,
): void {
	const view: ImageWorkflowsView = {
		workflows: options.store.listImageWorkflows(),
	};
	sendJson(res, 200, view);
}

async function handleImageWorkflowDetect(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["workflow"]);
	if (!Object.hasOwn(body, "workflow")) {
		throw fieldError("workflow", "workflow 必须提供");
	}
	let workflow: ComfyUiWorkflow;
	try {
		workflow = parseComfyUiWorkflow(body.workflow, "workflow");
	} catch (error) {
		throw toBadRequest(error, "workflow");
	}
	try {
		const detection: ImageWorkflowDetectionView = detectComfyUiSlots(workflow);
		sendJson(res, 200, detection);
	} catch (error) {
		throw toBadRequest(error, "workflow");
	}
}

async function handleImageWorkflowImport(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
): Promise<void> {
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["name", "workflow", "slots"]);
	const name = requireText(body.name, "name");
	if (!Object.hasOwn(body, "workflow")) {
		throw fieldError("workflow", "workflow 必须提供");
	}
	if (!Object.hasOwn(body, "slots")) {
		throw fieldError("slots", "slots 必须提供");
	}
	let workflow: ComfyUiWorkflow;
	try {
		workflow = parseComfyUiWorkflow(body.workflow, "workflow");
	} catch (error) {
		throw toBadRequest(error, "workflow");
	}
	let slots: ComfyUiSlots;
	try {
		slots = assertComfyUiSlots(workflow, body.slots, "slots");
	} catch (error) {
		throw toBadRequest(error, "slots");
	}
	const config =
		options.imagesPath === null
			? emptyImagesConfig()
			: await loadImagesConfig(options.imagesPath, options.imagesEnv);
	let providerId: string;
	try {
		providerId = resolveImageProvider(config).id;
	} catch (error) {
		throw toBadRequest(error, "provider");
	}
	try {
		const saved = options.store.saveImageWorkflow({
			name,
			provider: providerId,
			payload: workflow,
			slots,
		});
		sendJson(res, 200, saved);
	} catch (error) {
		throw toBadRequest(error, "slots");
	}
}

function handleImageWorkflowDelete(
	res: ServerResponse,
	options: ApiRouteOptions,
	workflowId: string,
): void {
	if (options.store.getImageWorkflow(workflowId) === null) {
		throw new HttpError(404, "not_found", `workflow 不存在：${workflowId}`);
	}
	try {
		options.store.deleteImageWorkflow(workflowId);
	} catch (error) {
		if (error instanceof ImageWorkflowInUseError) {
			throw new HttpError(409, "conflict", error.message, { workflowId });
		}
		throw error;
	}
	sendEmpty(res, 204);
}

function handleImageRetry(
	res: ServerResponse,
	options: ApiRouteOptions,
	imageId: string,
): void {
	const image = options.store.getNodeImage(imageId);
	if (image === null) {
		throw new HttpError(404, "not_found", `图片记录不存在：${imageId}`);
	}
	if (image.status !== "failed") {
		throw new HttpError(
			409,
			"conflict",
			`图片记录 ${imageId} 的状态是 ${image.status}，只有 failed 可以重试`,
		);
	}
	const retried = options.store.retryNodeImage(imageId);
	enqueueIllustrateBackgroundJob(options.store, image.storyId);
	options.scheduler?.schedule(image.storyId);
	const view: NodeImageRecord = retried;
	sendJson(res, 200, view);
}

async function handleNodeImages(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): Promise<void> {
	const node = requireNode(options.store, nodeId);
	if (node.role !== "assistant") {
		throw fieldError("nodeId", `楼层 ${nodeId} 不是助手楼层，不能登记插图`);
	}
	const pathIds = new Set(
		options.store.getPathToHead(node.storyId).map((item) => item.id),
	);
	if (!pathIds.has(nodeId)) {
		throw new HttpError(
			409,
			"conflict",
			`楼层 ${nodeId} 不在当前路径上，不能登记插图`,
		);
	}
	const settings = options.store.getStorySettings(node.storyId);
	if (settings.imageConfig.mode === "off") {
		throw new HttpError(409, "conflict", "生图模式已关闭");
	}
	const workflowId = settings.imageConfig.workflowId.trim();
	if (workflowId.length === 0) {
		throw new HttpError(409, "conflict", "故事没有选择生图 workflow");
	}
	const workflow = options.store.getImageWorkflow(workflowId);
	if (workflow === null) {
		throw new HttpError(409, "conflict", `图片 workflow 不存在：${workflowId}`);
	}
	if (!options.imagesConfig.providers.has(workflow.provider)) {
		throw new HttpError(
			409,
			"conflict",
			`生图 workflow 的 provider 没有配置：${workflow.provider}`,
		);
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	let request: ImagePromptRequest;
	try {
		request = validateImagePromptRequest(body);
	} catch (error) {
		throw toBadRequest(error, "request");
	}
	const image = options.store.insertNodeImage({
		storyId: node.storyId,
		nodeId,
		request,
		workflowId,
		seed: Math.floor(Math.random() * 2_147_483_648),
	});
	enqueueIllustrateBackgroundJob(options.store, node.storyId);
	options.scheduler?.schedule(node.storyId);
	const view: NodeImageRecord = image;
	sendJson(res, 201, view);
}

function handleNodeImageList(
	res: ServerResponse,
	options: ApiRouteOptions,
	nodeId: string,
): void {
	const node = requireNode(options.store, nodeId);
	const view: NodeImagesView = {
		nodeId: node.id,
		images: options.store.listNodeImages(node.id).map(toNodeImage),
	};
	sendJson(res, 200, view);
}

const IMAGE_MEDIA_TYPES: Readonly<Record<string, true>> = {
	"image/png": true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif": true,
};

/**
 * 媒体接口只返回已完成的图片，文件名来自数据库；解析后必须仍在
 * `imagesMediaDir` 里，软链接也要通过真实路径检查。
 */
async function handleImageFile(
	res: ServerResponse,
	options: ApiRouteOptions,
	imageId: string,
): Promise<void> {
	const image = options.store.getNodeImage(imageId);
	if (
		image === null ||
		image.status !== "done" ||
		image.fileName === null ||
		image.mediaType === null ||
		IMAGE_MEDIA_TYPES[image.mediaType] !== true
	) {
		throw imageFileMissing();
	}
	const filePath = await resolveImageFile(
		options.imagesMediaDir,
		image.fileName,
	);
	if (filePath === null) throw imageFileMissing();
	let bytes: Buffer;
	try {
		bytes = await readFile(filePath);
	} catch {
		throw imageFileMissing();
	}
	res.writeHead(200, {
		"Content-Type": image.mediaType,
		"Content-Length": bytes.length,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, max-age=31536000, immutable",
	});
	res.end(bytes);
}

function imageFileMissing(): HttpError {
	return new HttpError(404, "not_found", "图片文件不存在");
}

async function resolveImageFile(
	mediaDir: string,
	fileName: string,
): Promise<string | null> {
	const target = resolve(mediaDir, fileName);
	if (!isInsideDirectory(mediaDir, target)) return null;
	let realTarget: string;
	let realRoot: string;
	try {
		realRoot = await realpath(mediaDir);
		realTarget = await realpath(target);
	} catch {
		return null;
	}
	if (!isInsideDirectory(realRoot, realTarget)) return null;
	const info = await stat(realTarget).catch(() => null);
	if (info === null || !info.isFile()) return null;
	return realTarget;
}

function isInsideDirectory(root: string, candidate: string): boolean {
	const relativePath = relative(root, candidate);
	return (
		relativePath.length > 0 &&
		relativePath !== ".." &&
		!relativePath.startsWith(`..${sep}`) &&
		!isAbsolute(relativePath)
	);
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

/** 返回故事实际使用的上下文模板；故事使用内置默认模板时 source 为 default。 */
function handleStoryTemplate(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const settings = options.store.getStorySettings(storyId);
	const storedId =
		settings.templateId === null ||
		settings.templateId === DEFAULT_CONTEXT_TEMPLATE_ID
			? null
			: settings.templateId;
	const stored =
		storedId === null ? null : options.store.getContextTemplate(storedId);
	if (storedId !== null && stored === null) {
		throw new Error(`故事引用的上下文模板不存在：${storedId}`);
	}
	const view: StoryTemplateView = {
		storyId,
		templateId: stored === null ? null : stored.id,
		source: stored === null ? "default" : "stored",
		template:
			stored === null
				? createDefaultContextTemplate({
						structuredOutput: settings.structuredOutput,
					})
				: stored.template,
		blockFormatSegment: createBlockFormatSegment(settings.structuredOutput),
	};
	sendJson(res, 200, view);
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
