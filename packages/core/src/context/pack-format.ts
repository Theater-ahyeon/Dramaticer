import { createHash } from "node:crypto";
import type { ChatProfile } from "../chat/profile.js";
import { isJsonObject } from "../json.js";
import type { AssembledContext, ContextSlotProviders } from "./assembler.js";
import type { ContextSlotName, ContextTemplate } from "./template.js";

/** 上下文包 payload 的结构版本；字段不兼容时递增。 */
export const CONTEXT_PACK_VERSION = 1;

export type ContextPackAssembled = AssembledContext;

/** 组装时使用的台账快照版本：楼层与路径上的 diff 条数。 */
export interface ContextPackLedgerSnapshot {
	readonly nodeId: string;
	readonly diffCount: number;
}

export interface ContextPackReferences {
	readonly loreEntryIds: readonly string[];
	readonly sceneAnalysisNodeId: string | null;
	readonly retrievalNodeIds: readonly string[];
	readonly ledgerSnapshot: ContextPackLedgerSnapshot;
}

export interface ContextPackPayload {
	readonly version: typeof CONTEXT_PACK_VERSION;
	/** 组装输入的指纹；模板、预算、档位与槽位配置变化后不复用旧包。 */
	readonly fingerprint: string;
	readonly assembled: ContextPackAssembled;
	readonly references: ContextPackReferences;
}

export interface ContextPack {
	readonly nodeId: string;
	readonly storyId: string;
	readonly payload: ContextPackPayload;
	readonly createdAt: string;
}

export interface NewContextPackInput {
	readonly nodeId: string;
	readonly storyId: string;
	readonly payload: ContextPackPayload;
	readonly createdAt?: string;
}

export interface ContextPackFingerprintInput {
	readonly template: ContextTemplate;
	readonly budgetTokens: number;
	readonly profile: ChatProfile;
	readonly providers: ContextSlotProviders | undefined;
	/** 本轮临时开关；不同的临时开关不复用同一个包。 */
	readonly featureOverrides?: Readonly<Record<string, unknown>> | null;
	/** 本轮推进档位；原著窗口在推进时给的内容不同，不能复用旧包。 */
	readonly directorPush?: string | null;
}

/**
 * 槽位配置指纹：按槽位名排序，带上各提供者声明的 `packKey`。
 * 没有声明 packKey 的提供者只按槽位名区分。
 */
function providerKeys(
	providers: ContextSlotProviders | undefined,
): readonly (readonly [string, string | null])[] {
	if (providers === undefined) return [];
	const names = Object.keys(providers).sort();
	return names.map((name) => [
		name,
		providers[name as ContextSlotName]?.packKey ?? null,
	]);
}

function sortedEntries(
	value: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] {
	return Object.keys(value)
		.sort()
		.map((key) => [key, value[key]]);
}

/** 组装输入的稳定指纹；同一节点只在指纹一致时复用旧包。 */
export function contextPackFingerprint(
	input: ContextPackFingerprintInput,
): string {
	const serialised = JSON.stringify({
		template: input.template,
		budgetTokens: input.budgetTokens,
		profile: input.profile,
		providers: providerKeys(input.providers),
		...(input.featureOverrides === undefined ||
		input.featureOverrides === null ||
		Object.keys(input.featureOverrides).length === 0
			? {}
			: { featureOverrides: sortedEntries(input.featureOverrides) }),
		directorPush: input.directorPush ?? null,
	});
	return createHash("sha256").update(serialised).digest("hex");
}

/** 写入前的结构校验；不合法时抛错并指出字段。 */
export function assertContextPackPayload(payload: ContextPackPayload): void {
	if (!isJsonObject(payload)) {
		throw new Error("上下文包的 payload 必须是对象");
	}
	if (payload.version !== CONTEXT_PACK_VERSION) {
		throw new Error(
			`上下文包的版本必须是 ${CONTEXT_PACK_VERSION}，实际为 ${String(payload.version)}`,
		);
	}
	if (
		typeof payload.fingerprint !== "string" ||
		payload.fingerprint.length === 0
	) {
		throw new Error("上下文包的 fingerprint 必须是非空字符串");
	}
	assertAssembled(payload.assembled, "上下文包 assembled");
	assertReferences(payload.references, "上下文包 references");
}

export function serializeContextPackPayload(
	payload: ContextPackPayload,
): string {
	assertContextPackPayload(payload);
	return JSON.stringify(payload);
}

export function parseContextPackPayload(text: string): ContextPackPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("上下文包的 payload 不是合法 JSON");
	}
	assertContextPackPayload(parsed as ContextPackPayload);
	return parsed as ContextPackPayload;
}

const MESSAGE_ROLES: Readonly<Record<string, true>> = {
	system: true,
	user: true,
	assistant: true,
};
const TRACE_STATUSES: Readonly<Record<string, true>> = {
	included: true,
	"condition-false": true,
	"missing-slot": true,
	"budget-dropped": true,
};
const SEGMENT_KINDS: Readonly<Record<string, true>> = {
	static: true,
	slot: true,
};

function assertAssembled(value: unknown, label: string): void {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	assertMessages(value.messages, `${label}.messages`);
	if (!Array.isArray(value.segments)) {
		throw new Error(`${label}.segments 必须是数组`);
	}
	value.segments.forEach((segment, index) => {
		assertSegment(segment, `${label}.segments[${index}]`);
	});
	assertTrace(value.trace, `${label}.trace`);
	assertInjectedReferences(value.references, `${label}.references`);
}

function assertMessages(value: unknown, label: string): void {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	value.forEach((message, index) => {
		const itemLabel = `${label}[${index}]`;
		if (!isJsonObject(message)) {
			throw new Error(`${itemLabel} 必须是对象`);
		}
		if (
			typeof message.role !== "string" ||
			MESSAGE_ROLES[message.role] !== true
		) {
			throw new Error(`${itemLabel}.role 必须是 system、user 或 assistant`);
		}
		if (typeof message.content !== "string" || message.content.length === 0) {
			throw new Error(`${itemLabel}.content 必须是非空字符串`);
		}
	});
}

function assertSegment(value: unknown, label: string): void {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	for (const key of ["segmentId", "source"]) {
		if (typeof value[key] !== "string" || value[key].length === 0) {
			throw new Error(`${label}.${key} 必须是非空字符串`);
		}
	}
	if (typeof value.kind !== "string" || SEGMENT_KINDS[value.kind] !== true) {
		throw new Error(`${label}.kind 必须是 static 或 slot`);
	}
	if (value.slot !== null && typeof value.slot !== "string") {
		throw new Error(`${label}.slot 必须是字符串或 null`);
	}
	if (
		typeof value.tokens !== "number" ||
		!Number.isFinite(value.tokens) ||
		value.tokens < 0
	) {
		throw new Error(`${label}.tokens 必须是非负有限数字`);
	}
	assertMessages(value.messages, `${label}.messages`);
}

function assertTrace(value: unknown, label: string): void {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	for (const key of ["budgetTokens", "totalTokens"]) {
		const amount = value[key];
		if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
			throw new Error(`${label}.${key} 必须是非负有限数字`);
		}
	}
	if (!Array.isArray(value.entries)) {
		throw new Error(`${label}.entries 必须是数组`);
	}
	value.entries.forEach((entry, index) => {
		assertTraceEntry(entry, `${label}.entries[${index}]`);
	});
}

function assertTraceEntry(value: unknown, label: string): void {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	for (const key of ["segmentId", "source"]) {
		if (typeof value[key] !== "string" || value[key].length === 0) {
			throw new Error(`${label}.${key} 必须是非空字符串`);
		}
	}
	if (typeof value.kind !== "string" || SEGMENT_KINDS[value.kind] !== true) {
		throw new Error(`${label}.kind 必须是 static 或 slot`);
	}
	if (value.slot !== null && typeof value.slot !== "string") {
		throw new Error(`${label}.slot 必须是字符串或 null`);
	}
	if (typeof value.priority !== "number" || !Number.isFinite(value.priority)) {
		throw new Error(`${label}.priority 必须是有限数字`);
	}
	if (
		typeof value.tokens !== "number" ||
		!Number.isFinite(value.tokens) ||
		value.tokens < 0
	) {
		throw new Error(`${label}.tokens 必须是非负有限数字`);
	}
	if (
		typeof value.status !== "string" ||
		TRACE_STATUSES[value.status] !== true
	) {
		throw new Error(`${label}.status 不合法：${String(value.status)}`);
	}
	if (value.items !== undefined) {
		assertTraceItems(value.items, `${label}.items`);
	}
}

function assertTraceItems(value: unknown, label: string): void {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	value.forEach((item, index) => {
		const itemLabel = `${label}[${index}]`;
		if (!isJsonObject(item)) {
			throw new Error(`${itemLabel} 必须是对象`);
		}
		if (typeof item.label !== "string" || item.label.length === 0) {
			throw new Error(`${itemLabel}.label 必须是非空字符串`);
		}
		if (
			typeof item.tokens !== "number" ||
			!Number.isFinite(item.tokens) ||
			item.tokens < 0
		) {
			throw new Error(`${itemLabel}.tokens 必须是非负有限数字`);
		}
		const source = item.source;
		if (!isJsonObject(source) || typeof source.kind !== "string") {
			throw new Error(`${itemLabel}.source 必须带 kind`);
		}
		const sourceLabel = `${itemLabel}.source`;
		switch (source.kind) {
			case "record": {
				const ids = source.ids;
				assertStringArray(ids, `${sourceLabel}.ids`);
				if (!Array.isArray(ids) || ids.length === 0) {
					throw new Error(`${sourceLabel}.ids 不能为空`);
				}
				assertNonEmptyStringField(source.nodeId, `${sourceLabel}.nodeId`);
				assertNumberField(source.floorNo, `${sourceLabel}.floorNo`);
				return;
			}
			case "lore":
			case "wiki":
				assertNonEmptyStringField(source.id, `${sourceLabel}.id`);
				assertNonEmptyStringField(source.name, `${sourceLabel}.name`);
				return;
			case "state":
				assertNonEmptyStringField(source.target, `${sourceLabel}.target`);
				assertNonEmptyStringField(source.label, `${sourceLabel}.label`);
				return;
			case "floor":
				assertNonEmptyStringField(source.nodeId, `${sourceLabel}.nodeId`);
				assertNumberField(source.floorNo, `${sourceLabel}.floorNo`);
				return;
			case "scene":
				assertNonEmptyStringField(source.nodeId, `${sourceLabel}.nodeId`);
				return;
			case "segment":
				assertNonEmptyStringField(source.segmentId, `${sourceLabel}.segmentId`);
				return;
			case "slot":
				assertNonEmptyStringField(source.slot, `${sourceLabel}.slot`);
				return;
			case "summary":
			case "pref":
			case "card":
			case "outline":
				assertNonEmptyStringField(source.id, `${sourceLabel}.id`);
				return;
			case "canon": {
				assertNonEmptyStringField(source.bookId, `${sourceLabel}.bookId`);
				if (
					typeof source.eventId !== "number" ||
					!Number.isInteger(source.eventId) ||
					source.eventId < 1
				) {
					throw new Error(`${sourceLabel}.eventId 必须是正整数`);
				}
				if (
					typeof source.chapterOrdinal !== "number" ||
					!Number.isInteger(source.chapterOrdinal) ||
					source.chapterOrdinal < 1
				) {
					throw new Error(`${sourceLabel}.chapterOrdinal 必须是正整数`);
				}
				return;
			}
			default:
				throw new Error(`${sourceLabel}.kind 不合法：${source.kind}`);
		}
	});
}

function assertNonEmptyStringField(value: unknown, label: string): void {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
}

function assertNumberField(value: unknown, label: string): void {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${label} 必须是有限数字`);
	}
}

function assertInjectedReferences(value: unknown, label: string): void {
	if (!isJsonObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	assertStringArray(value.loreEntryIds, `${label}.loreEntryIds`);
	assertStringArray(value.retrievalNodeIds, `${label}.retrievalNodeIds`);
	if (
		value.sceneAnalysisNodeId !== null &&
		(typeof value.sceneAnalysisNodeId !== "string" ||
			value.sceneAnalysisNodeId.length === 0)
	) {
		throw new Error(`${label}.sceneAnalysisNodeId 必须是非空字符串或 null`);
	}
}

function assertReferences(value: unknown, label: string): void {
	assertInjectedReferences(value, label);
	const snapshot = (value as Record<string, unknown>).ledgerSnapshot;
	if (!isJsonObject(snapshot)) {
		throw new Error(`${label}.ledgerSnapshot 必须是对象`);
	}
	if (typeof snapshot.nodeId !== "string" || snapshot.nodeId.length === 0) {
		throw new Error(`${label}.ledgerSnapshot.nodeId 必须是非空字符串`);
	}
	if (
		typeof snapshot.diffCount !== "number" ||
		!Number.isInteger(snapshot.diffCount) ||
		snapshot.diffCount < 0
	) {
		throw new Error(`${label}.ledgerSnapshot.diffCount 必须是非负整数`);
	}
}

function assertStringArray(value: unknown, label: string): void {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	value.forEach((item, index) => {
		if (typeof item !== "string" || item.length === 0) {
			throw new Error(`${label}[${index}] 必须是非空字符串`);
		}
	});
}
