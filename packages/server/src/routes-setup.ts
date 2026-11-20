// server 路由：开场、导入体检、角色外观、故事设置与上下文模板（refactor/06 从 routes.ts 拆出）。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ChooseOpeningCandidateResult,
	type ContextTemplate,
	type ContextTemplateRecord,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	IMPORT_KIND_JOB_KIND,
	OPENING_CANDIDATES_JOB_KIND,
	OPENING_CANDIDATE_STATUSES,
	STORY_SETTINGS_UPDATE_KEYS,
	type StorySettings,
	type StorySettingsUpdate,
	type UpdateContextTemplateInput,
	VISUAL_PROFILE_JOB_KIND,
	buildImportAuditReport,
	createBlockFormatSegment,
	createDefaultContextTemplate,
	importKindSuggestionsNeedRun,
	isImportEntryKind,
	isOpeningCandidateStatus,
} from "@dramaticer/core";
import {
	type CreateContextTemplateRequest,
	type ImportAuditEntryKindUpdateRequest,
	type ImportAuditEntryKindUpdateResult,
	type ImportAuditEntryMemoryUpdateRequest,
	type ImportAuditEntryMemoryUpdateResult,
	type ImportAuditMemoryConvertResult,
	type ImportAuditReportView,
	type ImportAuditSuggestionResult,
	type StoryOpeningGenerateResult,
	type StoryOpeningPickResult,
	type StoryOpeningsView,
	type StoryTemplateView,
	type StoryVisualProfileGenerateResult,
	type StoryVisualProfilesView,
	isImportAuditPlayerSource,
} from "@dramaticer/protocol";
import { HttpError, sendEmpty, sendJson } from "./http.js";
import {
	assertKnownKeys,
	fieldError,
	inferSettingsPath,
	readObjectBody,
	requireMethod,
	requireObject,
	requireStory,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import { buildPath } from "./routes-stories.js";
import { rememberWritingMode, withWritingMode } from "./routes-turns.js";
import type { ApiRouteOptions } from "./routes.js";

export function handleOpenings(
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

export function handleStoryVisualProfiles(
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

export function handleStoryVisualProfilesGenerate(
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

/** 导入体检数据：条数、需要逐条查看的条目与常驻 token 的前后估算。 */
export function buildImportAuditReportView(
	options: ApiRouteOptions,
	storyId: string,
): ImportAuditReportView {
	return {
		...buildImportAuditReport({
			storyId,
			entries: options.store.listImportAuditEntries(storyId),
			loreEntries: options.store.listLoreEntries(storyId),
		}),
		importMode: options.store.getStorySettings(storyId).importMode,
	};
}

export function handleImportAudit(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	sendJson(res, 200, buildImportAuditReportView(options, storyId));
}

/** 玩家改一条条目的类型；`kindSource` 为 `rule` 时撤销改动回到规则判定。 */
export async function handleImportAuditEntryUpdate(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	source: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["kind", "kindSource"]);
	const kind = body.kind;
	if (!isImportEntryKind(kind)) {
		throw fieldError("kind", `导入分型的类型不合法：${String(kind)}`);
	}
	const kindSource = body.kindSource ?? "player";
	if (!isImportAuditPlayerSource(kindSource)) {
		throw fieldError("kindSource", "类型来源只能是 player 或 rule");
	}
	const existing = options.store
		.listImportAuditEntries(storyId)
		.find((entry) => entry.source === source);
	if (existing === undefined) {
		throw new HttpError(404, "not_found", `导入审计条目不存在：${source}`);
	}
	const request: ImportAuditEntryKindUpdateRequest = { kind, kindSource };
	let entry: ImportAuditEntryKindUpdateResult["entry"];
	try {
		entry = options.store.setImportAuditEntryKind(
			storyId,
			source,
			request.kind,
			request.kindSource ?? "player",
		);
	} catch (error) {
		throw toBadRequest(error, "kind");
	}
	const result: ImportAuditEntryKindUpdateResult = {
		entry,
		report: buildImportAuditReportView(options, storyId),
	};
	sendJson(res, 200, result);
}

/** 转换或撤销一条插件残留条目的初始记忆状态。 */
export async function handleImportAuditEntryMemory(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
	source: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["memory"]);
	if (typeof body.memory !== "boolean") {
		throw fieldError("memory", "memory 必须是布尔值");
	}
	const existing = options.store
		.listImportAuditEntries(storyId)
		.find((entry) => entry.source === source);
	if (existing === undefined) {
		throw new HttpError(404, "not_found", `导入审计条目不存在：${source}`);
	}
	const request: ImportAuditEntryMemoryUpdateRequest = { memory: body.memory };
	let entry: ImportAuditEntryMemoryUpdateResult["entry"];
	try {
		entry = options.store.setImportAuditEntryMemory(
			storyId,
			source,
			request.memory,
		);
	} catch (error) {
		throw toBadRequest(error, "memory");
	}
	const result: ImportAuditEntryMemoryUpdateResult = {
		entry,
		report: buildImportAuditReportView(options, storyId),
	};
	sendJson(res, 200, result);
}

/** 把全部插件残留条目一次转成初始记忆。 */
export function handleImportAuditMemoryConvert(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const converted =
		options.store.convertImportAuditPluginResidueToMemory(storyId);
	const result: ImportAuditMemoryConvertResult = {
		converted,
		report: buildImportAuditReportView(options, storyId),
	};
	sendJson(res, 200, result);
}

/** 入队一次后台建议；建议在间隙执行，不改写条目正文。 */
export function handleImportAuditSuggestions(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	if (!importKindSuggestionsNeedRun(options.store, storyId)) {
		throw new HttpError(409, "conflict", "没有等待建议的未识别条目");
	}
	const [job] = options.store.enqueueStoryBackgroundJobs({
		storyId,
		kinds: [IMPORT_KIND_JOB_KIND],
	});
	if (job === undefined) {
		throw new Error(`故事 ${storyId} 的导入分型建议任务没有入队`);
	}
	options.scheduler?.schedule(storyId);
	const view: ImportAuditSuggestionResult = {
		storyId,
		jobId: job.id,
		kind: job.kind,
	};
	sendJson(res, 202, view);
}

export function handleOpeningGenerate(
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

export function handleOpeningPick(
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

export async function handleSettings(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireMethod(method, ["GET", "PUT"]);
	requireStory(options.store, storyId);
	if (method === "GET") {
		sendJson(
			res,
			200,
			withWritingMode(options.store, options.store.getStorySettings(storyId)),
		);
		return;
	}
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, STORY_SETTINGS_UPDATE_KEYS);
	if (body.turnMode !== undefined) {
		rememberWritingMode(options.store, storyId, body.turnMode);
		if (body.turnMode === "plan") body.turnMode = "fast";
	}
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
	sendJson(res, 200, withWritingMode(options.store, settings));
}

/** 返回故事实际使用的上下文模板；故事使用内置默认模板时 source 为 default。 */
export function handleStoryTemplate(
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
						layout: settings.contextLayout,
					})
				: stored.template,
		blockFormatSegment: createBlockFormatSegment(settings.structuredOutput),
	};
	sendJson(res, 200, view);
}

export async function handleTemplates(
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

export async function handleTemplate(
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
