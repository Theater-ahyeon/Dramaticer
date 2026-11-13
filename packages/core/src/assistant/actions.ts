import {
	type ContextTemplate,
	assertContextTemplate,
} from "../context/template.js";
import { parseDirectorPlan, replaceDirectorPlan } from "../director/plan.js";
import { assertImageConfig } from "../images/types.js";
import type { ImageConfig } from "../images/types.js";
import { type JsonObject, assertJsonValue, isJsonObject } from "../json.js";
import type { NewLoreEntryInput } from "../memory/lore.js";
import {
	STORY_SETTINGS_UPDATE_KEYS,
	type StorySettingsUpdate,
	assertStoredContextTemplate,
	assertStorySettingsUpdate,
} from "../store/settings.js";
import type { StoryStore } from "../store/story-store.js";

/** 助手待确认动作的种类；台账修改不在其中，它直接生成台账变更卡。 */
export const ASSISTANT_ACTION_KINDS = [
	"channels",
	"settings",
	"template",
	"lore",
	"director_plan",
	"card",
	"image_config",
] as const;

export type AssistantActionKind = (typeof ASSISTANT_ACTION_KINDS)[number];

export const ASSISTANT_ACTION_STATUSES = [
	"pending",
	"approved",
	"rejected",
] as const;

export type AssistantActionStatus = (typeof ASSISTANT_ACTION_STATUSES)[number];

/** `auto` 级别也只直接执行的种类；其余种类一律等待玩家确认。 */
export const AUTO_EXECUTABLE_ACTION_KINDS = ["channels"] as const;

const AUTO_EXECUTABLE_ACTION_KIND_SET: ReadonlySet<string> = new Set(
	AUTO_EXECUTABLE_ACTION_KINDS,
);

export const DEFAULT_ASSISTANT_ACTION_LIST_LIMIT = 50;
export const MAX_ASSISTANT_ACTION_LIST_LIMIT = 100;

export type AssistantActionErrorCode = "not_found" | "invalid_status";

export class AssistantActionError extends Error {
	readonly code: AssistantActionErrorCode;

	constructor(code: AssistantActionErrorCode, message: string) {
		super(message);
		this.name = "AssistantActionError";
		this.code = code;
	}
}

export class AssistantActionPayloadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssistantActionPayloadError";
	}
}

/** 删除会话时仍有待确认动作；先批准或拒绝再删除。 */
export class AssistantConversationHasPendingActionsError extends Error {
	readonly conversationId: string;
	readonly pendingCount: number;

	constructor(conversationId: string, pendingCount: number) {
		super(
			`助手会话 ${conversationId} 还有 ${pendingCount} 个待确认动作，先批准或拒绝再删除`,
		);
		this.name = "AssistantConversationHasPendingActionsError";
		this.conversationId = conversationId;
		this.pendingCount = pendingCount;
	}
}

export interface AssistantAction {
	readonly id: string;
	readonly conversationId: string;
	readonly storyId: string | null;
	readonly kind: AssistantActionKind;
	readonly summary: string;
	readonly payload: JsonObject;
	readonly status: AssistantActionStatus;
	readonly rejectionReason: string | null;
	readonly createdAt: string;
	readonly decidedAt: string | null;
}

export interface NewAssistantActionInput {
	readonly id?: string;
	readonly conversationId: string;
	readonly kind: AssistantActionKind;
	readonly summary: string;
	readonly payload: JsonObject;
	readonly createdAt?: string;
}

export interface ListAssistantActionsOptions {
	readonly conversationId?: string;
	readonly storyId?: string;
	readonly status?: AssistantActionStatus;
	readonly limit?: number;
}

export function isAssistantActionKind(
	value: unknown,
): value is AssistantActionKind {
	return (
		typeof value === "string" &&
		(ASSISTANT_ACTION_KINDS as readonly string[]).includes(value)
	);
}

export function assertAssistantActionKind(
	value: unknown,
	label: string,
): asserts value is AssistantActionKind {
	if (!isAssistantActionKind(value)) {
		throw new Error(
			`${label} 只能是 ${ASSISTANT_ACTION_KINDS.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
}

export function isAssistantActionStatus(
	value: unknown,
): value is AssistantActionStatus {
	return (
		typeof value === "string" &&
		(ASSISTANT_ACTION_STATUSES as readonly string[]).includes(value)
	);
}

export function assertAssistantActionStatus(
	value: unknown,
	label: string,
): asserts value is AssistantActionStatus {
	if (!isAssistantActionStatus(value)) {
		throw new Error(
			`${label} 只能是 ${ASSISTANT_ACTION_STATUSES.join("、")}，收到 ${JSON.stringify(value)}`,
		);
	}
}

export function assertAssistantActionListLimit(
	value: unknown,
	label: string,
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > MAX_ASSISTANT_ACTION_LIST_LIMIT
	) {
		throw new Error(
			`${label} 必须是 1 到 ${MAX_ASSISTANT_ACTION_LIST_LIMIT} 之间的整数：${String(value)}`,
		);
	}
}

/** 自动级别是否可以不经确认执行某种动作。 */
export function canAutoExecuteAssistantAction(
	kind: AssistantActionKind,
): boolean {
	return AUTO_EXECUTABLE_ACTION_KIND_SET.has(kind);
}

const CHANNELS_KEYS = ["channels", "models", "embeddings", "roles"] as const;
const TEMPLATE_KEYS = ["templateId", "name", "template"] as const;
const CARD_KEYS = ["cardName", "characterPrompt", "persona"] as const;
const LORE_ENTRY_KEYS = [
	"entityId",
	"name",
	"content",
	"constant",
	"keywords",
] as const;

/**
 * 校验待确认动作的载荷。创建时与批准前各调用一次：创建时尽早拒绝模型
 * 生成的非法提案，批准前重新校验，防止写入函数拿到过期或手改的载荷。
 */
export function assertAssistantActionPayload(
	kind: AssistantActionKind,
	payload: JsonObject,
): void {
	assertJsonValue(payload, "payload");
	if (!isJsonObject(payload)) {
		throw new AssistantActionPayloadError("payload 必须是 JSON 对象");
	}
	switch (kind) {
		case "channels":
			assertChannelsPayload(payload);
			return;
		case "settings":
			assertSettingsPayload(payload);
			return;
		case "template":
			assertTemplatePayload(payload);
			return;
		case "lore":
			assertLorePayload(payload);
			return;
		case "director_plan":
			assertDirectorPlanPayload(payload);
			return;
		case "card":
			assertCardPayload(payload);
			return;
		case "image_config":
			assertImageConfigPayload(payload);
			return;
	}
}

function assertKnownKeys(
	payload: JsonObject,
	allowed: readonly string[],
	label: string,
): void {
	for (const key of Object.keys(payload)) {
		if (!allowed.includes(key)) {
			throw new AssistantActionPayloadError(`${label}.${key} 是未知字段`);
		}
	}
}

function assertChannelsPayload(payload: JsonObject): void {
	assertKnownKeys(payload, CHANNELS_KEYS, "payload");
	if (Object.keys(payload).length === 0) {
		throw new AssistantActionPayloadError("payload 至少要包含一个渠道配置段");
	}
	for (const key of CHANNELS_KEYS) {
		const value = payload[key];
		if (value !== undefined && !isJsonObject(value)) {
			throw new AssistantActionPayloadError(`payload.${key} 必须是对象`);
		}
	}
}

function assertSettingsPayload(payload: JsonObject): void {
	assertKnownKeys(payload, STORY_SETTINGS_UPDATE_KEYS, "payload");
	if (Object.keys(payload).length === 0) {
		throw new AssistantActionPayloadError("payload 至少要包含一个设置字段");
	}
	if (payload.imageConfig !== undefined) {
		throw new AssistantActionPayloadError(
			"生图配置使用 image_config 动作，不放在 settings 里",
		);
	}
	try {
		assertStorySettingsUpdate(payload as StorySettingsUpdate);
	} catch (error) {
		throw new AssistantActionPayloadError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

function assertTemplatePayload(payload: JsonObject): void {
	assertKnownKeys(payload, TEMPLATE_KEYS, "payload");
	const template = payload.template;
	if (!isJsonObject(template)) {
		throw new AssistantActionPayloadError("payload.template 必须是对象");
	}
	try {
		assertStoredContextTemplate(template as unknown as ContextTemplate);
	} catch (error) {
		throw new AssistantActionPayloadError(
			error instanceof Error ? error.message : String(error),
		);
	}
	if (payload.templateId !== undefined && payload.templateId !== null) {
		if (typeof payload.templateId !== "string" || !payload.templateId.trim()) {
			throw new AssistantActionPayloadError(
				"payload.templateId 必须是非空字符串或 null",
			);
		}
	}
	if (payload.name !== undefined) {
		if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
			throw new AssistantActionPayloadError("payload.name 必须是非空字符串");
		}
	}
	if (payload.templateId === undefined || payload.templateId === null) {
		if (payload.name === undefined) {
			throw new AssistantActionPayloadError("新建模板必须提供 payload.name");
		}
	}
}

function assertCardPayload(payload: JsonObject): void {
	assertKnownKeys(payload, CARD_KEYS, "payload");
	if (Object.keys(payload).length === 0) {
		throw new AssistantActionPayloadError("payload 至少要包含一个卡片字段");
	}
	try {
		assertStorySettingsUpdate(payload as StorySettingsUpdate);
	} catch (error) {
		throw new AssistantActionPayloadError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

function assertImageConfigPayload(payload: JsonObject): void {
	assertKnownKeys(payload, ["imageConfig"], "payload");
	try {
		assertImageConfig(payload.imageConfig, "payload.imageConfig");
	} catch (error) {
		throw new AssistantActionPayloadError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

function assertDirectorPlanPayload(payload: JsonObject): void {
	assertKnownKeys(payload, ["plan"], "payload");
	try {
		parseDirectorPlan(payload.plan, "payload.plan");
	} catch (error) {
		throw new AssistantActionPayloadError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

function assertLorePayload(payload: JsonObject): void {
	assertKnownKeys(payload, ["entries"], "payload");
	const entries = payload.entries;
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new AssistantActionPayloadError("payload.entries 必须是非空数组");
	}
	entries.forEach((item, index) => {
		const label = `payload.entries[${index}]`;
		if (!isJsonObject(item)) {
			throw new AssistantActionPayloadError(`${label} 必须是对象`);
		}
		for (const key of Object.keys(item)) {
			if (!(LORE_ENTRY_KEYS as readonly string[]).includes(key)) {
				throw new AssistantActionPayloadError(`${label}.${key} 是未知字段`);
			}
		}
		for (const key of ["name", "content"] as const) {
			const value = item[key];
			if (typeof value !== "string" || value.trim().length === 0) {
				throw new AssistantActionPayloadError(
					`${label}.${key} 必须是非空字符串`,
				);
			}
		}
		if (
			item.entityId !== undefined &&
			item.entityId !== null &&
			(typeof item.entityId !== "string" || item.entityId.trim().length === 0)
		) {
			throw new AssistantActionPayloadError(
				`${label}.entityId 必须是非空字符串或 null`,
			);
		}
		if (item.constant !== undefined && typeof item.constant !== "boolean") {
			throw new AssistantActionPayloadError(`${label}.constant 必须是布尔值`);
		}
		if (item.keywords !== undefined) {
			if (!Array.isArray(item.keywords)) {
				throw new AssistantActionPayloadError(
					`${label}.keywords 必须是字符串数组`,
				);
			}
			for (const keyword of item.keywords) {
				if (typeof keyword !== "string" || keyword.trim().length === 0) {
					throw new AssistantActionPayloadError(
						`${label}.keywords 里只能是非空字符串`,
					);
				}
			}
		}
	});
}

export interface AssistantActionApproveOptions {
	readonly decidedAt?: string;
	/** 渠道配置在仓库文件里，由 server 注入写入函数。 */
	readonly applyChannels?: (payload: JsonObject) => void | Promise<void>;
}

/**
 * 批准待确认动作：先重新校验载荷，再调用对应领域的现有写入函数，最后
 * 把状态改成 approved。任何一步失败都保留 pending，调用方拿到原因。
 * 台账修改不在这里，它只能走台账变更卡的批准接口。
 */
export async function approveAssistantAction(
	store: StoryStore,
	actionId: string,
	options: AssistantActionApproveOptions = {},
): Promise<AssistantAction> {
	const action = requirePendingAction(store, actionId, "批准");
	assertAssistantActionPayload(action.kind, action.payload);
	const decidedAt = options.decidedAt ?? new Date().toISOString();
	switch (action.kind) {
		case "channels": {
			if (options.applyChannels === undefined) {
				throw new AssistantActionPayloadError(
					"当前服务没有配置渠道文件，无法批准渠道动作",
				);
			}
			await options.applyChannels(action.payload);
			break;
		}
		case "settings": {
			requireStoryAction(action);
			if (action.storyId === null) {
				throw new AssistantActionPayloadError("故事设置动作必须关联故事");
			}
			store.updateStorySettings(
				action.storyId,
				action.payload as StorySettingsUpdate,
			);
			break;
		}
		case "card": {
			requireStoryAction(action);
			if (action.storyId === null) {
				throw new AssistantActionPayloadError("卡片字段动作必须关联故事");
			}
			store.updateStorySettings(
				action.storyId,
				action.payload as StorySettingsUpdate,
			);
			break;
		}
		case "template": {
			requireStoryAction(action);
			applyTemplateAction(store, action);
			break;
		}
		case "lore": {
			requireStoryAction(action);
			applyLoreAction(store, action);
			break;
		}
		case "director_plan": {
			requireStoryAction(action);
			if (action.storyId === null) {
				throw new AssistantActionPayloadError("导演计划动作必须关联故事");
			}
			replaceDirectorPlan(
				store,
				action.storyId,
				parseDirectorPlan(action.payload.plan, "payload.plan"),
			);
			break;
		}
		case "image_config": {
			requireStoryAction(action);
			if (action.storyId === null) {
				throw new AssistantActionPayloadError("生图配置动作必须关联故事");
			}
			store.updateStorySettings(action.storyId, {
				imageConfig: action.payload.imageConfig as unknown as ImageConfig,
			});
			break;
		}
	}
	return store.setAssistantActionDecision(actionId, "approved", {
		decidedAt,
	});
}

/** 拒绝待确认动作：只改状态并保留原因，不调用任何写入函数。 */
export function rejectAssistantAction(
	store: StoryStore,
	actionId: string,
	reason: string,
	options: { readonly decidedAt?: string } = {},
): AssistantAction {
	requirePendingAction(store, actionId, "拒绝");
	if (typeof reason !== "string" || reason.trim().length === 0) {
		throw new AssistantActionPayloadError("拒绝动作必须写明原因");
	}
	const decidedAt = options.decidedAt ?? new Date().toISOString();
	return store.setAssistantActionDecision(actionId, "rejected", {
		decidedAt,
		rejectionReason: reason.trim(),
	});
}

function requirePendingAction(
	store: StoryStore,
	actionId: string,
	verb: string,
): AssistantAction {
	const action = store.getAssistantAction(actionId);
	if (action === null) {
		throw new AssistantActionError(
			"not_found",
			`待确认动作不存在：${actionId}`,
		);
	}
	if (action.status !== "pending") {
		throw new AssistantActionError(
			"invalid_status",
			`待确认动作 ${actionId} 的状态是 ${action.status}，不能${verb}`,
		);
	}
	return action;
}

function requireStoryAction(action: AssistantAction): void {
	if (action.storyId === null) {
		throw new AssistantActionPayloadError(`${action.kind} 动作必须关联故事`);
	}
}

function applyTemplateAction(store: StoryStore, action: AssistantAction): void {
	if (action.storyId === null) return;
	const payload = action.payload;
	const template = payload.template as unknown as ContextTemplate;
	assertContextTemplate(template);
	const name =
		typeof payload.name === "string" ? payload.name.trim() : undefined;
	const templateId =
		typeof payload.templateId === "string" ? payload.templateId : null;
	if (templateId === null) {
		if (name === undefined) {
			throw new AssistantActionPayloadError("新建模板必须提供 payload.name");
		}
		store.createContextTemplate({ name, template });
		return;
	}
	if (store.getContextTemplate(templateId) === null) {
		throw new AssistantActionPayloadError(`上下文模板不存在：${templateId}`);
	}
	store.updateContextTemplate(templateId, {
		...(name === undefined ? {} : { name }),
		template,
	});
}

function applyLoreAction(store: StoryStore, action: AssistantAction): void {
	if (action.storyId === null) return;
	const entries = action.payload.entries;
	if (!Array.isArray(entries)) {
		throw new AssistantActionPayloadError("payload.entries 必须是非空数组");
	}
	const inputs: NewLoreEntryInput[] = entries.map((entry, index) => {
		if (!isJsonObject(entry)) {
			throw new AssistantActionPayloadError(
				`payload.entries[${index}] 必须是对象`,
			);
		}
		return {
			storyId: action.storyId as string,
			name: entry.name as string,
			content: entry.content as string,
			...(entry.entityId === undefined
				? {}
				: { entityId: entry.entityId as string | null }),
			...(entry.constant === undefined
				? {}
				: { constant: entry.constant as boolean }),
			...(entry.keywords === undefined
				? {}
				: { keywords: entry.keywords as string[] }),
			source: `assistant:${action.id}:${index}`,
		};
	});
	store.insertLoreEntries(inputs);
}

/**
 * 规范化载荷：对象键排序后序列化，同样的内容永远得到同一个键。
 * 创建待确认动作时用它判断是否已有相同的待定动作。
 */
export function canonicalAssistantActionPayload(payload: JsonObject): string {
	return JSON.stringify(sortJson(payload));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, sortJson(child)] as const);
		return Object.fromEntries(entries);
	}
	return value;
}
