import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ContextTemplate,
	type ContextTemplateRecord,
	DEFAULT_CONTEXT_TEMPLATE_ID,
	DIRECTOR_CONFIG_KEYS,
	STORY_SETTINGS_UPDATE_KEYS,
	type Story,
	type StorySettings,
	type StorySettingsUpdate,
	type StoryStore,
	type UpdateContextTemplateInput,
	isJsonObject,
} from "@dramaticer/core";
import type {
	CreateContextTemplateRequest,
	CreateStoryRequest,
	ImportCharacterCard,
	ImportStoryRequest,
	ImportStoryResult,
	StoryJobErrorView,
	StoryJobsView,
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
import { type TurnCoordinator, handleTurnStream } from "./turns.js";

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
		if (third === "import" && parts.length === 3) {
			await handleImport(req, res, method, options, storyId);
			return;
		}
		if (third === "turns" && parts.length === 3) {
			requireMethod(method, ["POST"]);
			await handleTurns(req, res, options, storyId);
			return;
		}
		if (third === "settings" && parts.length === 3) {
			await handleSettings(req, res, method, options, storyId);
			return;
		}
		if (third === "jobs" && parts.length === 3) {
			requireMethod(method, ["GET"]);
			handleJobs(res, options, storyId);
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
