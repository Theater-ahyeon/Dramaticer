import { stat } from "node:fs/promises";
import {
	type JsonObject,
	type JsonValue,
	type TokenEstimator,
	createTokenEstimator,
} from "@dramaticer/core";
import type { StChatEntry, StChatMessage } from "../chat-jsonl.js";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import { diffSnapshots, readSnapshot } from "../state-diff.js";
import type { DuplicationCurve, ReplyText } from "./duplication.js";
import { analyzeDuplication } from "./duplication.js";

export interface RoleCounts {
	readonly user: number;
	readonly assistant: number;
	readonly system: number;
}

export interface FieldBytes {
	readonly field: string;
	readonly bytes: number;
}

export interface ChatHealth {
	readonly characterName: string | null;
	/** 聊天文件本身的字节数。 */
	readonly fileBytes: number;
	/** 头部那一行的 UTF-8 字节数（重新序列化之后）。 */
	readonly headerBytes: number;
	readonly messageCount: number;
	readonly roleCounts: RoleCounts;
	/** 所有消息的 swipes 数组长度之和。 */
	readonly swipeCount: number;
	readonly bodyBytes: number;
	readonly swipeBodyBytes: number;
	readonly variablesBytes: number;
	readonly otherBytes: number;
	readonly rawBytes: number;
	readonly bodyTokens: number;
	readonly swipeBodyTokens: number;
	readonly variablesTokens: number;
	readonly otherTokens: number;
	/** 其他字段按字节数从大到小全量列出；不包含 `mes` 和 `variables`。 */
	readonly fieldBytes: readonly FieldBytes[];
	/** 主路径上每个楼层的 MVU 快照序列化之后的字节数。 */
	readonly snapshotBytes: number;
	/** 消息里物理存储的全部 MVU 快照（包含所有 swipe）序列化之后的字节数。 */
	readonly allSnapshotBytes: number;
	readonly diffCount: number;
	readonly diffBytes: number;
	readonly assistantReplyCount: number;
	readonly duplication: DuplicationCurve;
}

export interface AnalyzeChatOptions {
	readonly tokenEstimator?: TokenEstimator;
}

/**
 * 流式读取一个 ST 聊天文件并计算体检指标。
 *
 * 字节分类口径：正文是当前 swipe 的原文，变量是消息里物理存储的 variables（包含所有 swipe），
 * 其他是消息对象序列化之后减去前两项。序列化使用 JSON.stringify，和原始 JSONL 行可能有空白差异。
 */
export async function analyzeChat(
	path: string,
	options: AnalyzeChatOptions = {},
): Promise<ChatHealth> {
	const tokenEstimator = options.tokenEstimator ?? createTokenEstimator();
	const file = await stat(path);
	let characterName: string | null = null;
	let headerBytes = 0;
	let messageCount = 0;
	const roleCounts = { user: 0, assistant: 0, system: 0 };
	let swipeCount = 0;
	let bodyBytes = 0;
	let swipeBodyBytes = 0;
	let variablesBytes = 0;
	let rawBytes = 0;
	let bodyTokens = 0;
	let swipeBodyTokens = 0;
	let variablesTokens = 0;
	let totalTokens = 0;
	let snapshotBytes = 0;
	let allSnapshotBytes = 0;
	let diffCount = 0;
	let diffBytes = 0;
	let previousSnapshot: JsonObject | null = null;
	const fieldSizes = new Map<string, number>();
	const replies: ReplyText[] = [];

	for await (const entry of parseChatJsonlFile(path)) {
		if (entry.kind === "header") {
			characterName = entry.header.characterName;
			headerBytes = byteLength(JSON.stringify(entry.header.raw));
			continue;
		}
		const message = entry.message;
		messageCount += 1;
		countRole(roleCounts, message);
		const rawJson = JSON.stringify(message.raw);
		const rawSize = byteLength(rawJson);
		rawBytes += rawSize;
		totalTokens += tokenEstimator(rawJson);

		const bodySize = byteLength(message.text);
		const bodyTokenCount = tokenEstimator(message.text);
		bodyBytes += bodySize;
		bodyTokens += bodyTokenCount;

		for (const swipe of message.swipes) {
			swipeBodyBytes += byteLength(swipe.text);
			swipeBodyTokens += tokenEstimator(swipe.text);
		}
		swipeCount += message.swipes.length;

		const rawVariables = message.raw.variables;
		if (Array.isArray(rawVariables)) {
			for (const value of rawVariables) {
				allSnapshotBytes += snapshotSize(value);
			}
		} else {
			allSnapshotBytes += snapshotSize(rawVariables);
		}

		const variablesJson = serializeValue(message.raw.variables);
		if (variablesJson !== null) {
			variablesBytes += byteLength(variablesJson);
			variablesTokens += tokenEstimator(variablesJson);
		}

		for (const [field, value] of Object.entries(message.raw)) {
			if (field === "mes" || field === "variables") continue;
			const size = byteLength(serializeValue(value) ?? "null");
			fieldSizes.set(field, (fieldSizes.get(field) ?? 0) + size);
		}

		const snapshot = readSnapshot(
			message.variables,
			`第 ${message.index} 条消息`,
		);
		if (snapshot !== null) {
			snapshotBytes += snapshotSize(snapshot);
			const diffs = diffSnapshots(previousSnapshot, snapshot);
			diffCount += diffs.length;
			for (const diff of diffs) {
				diffBytes += byteLength(
					JSON.stringify([
						diff.path,
						diff.op,
						diff.op === "set" ? diff.value : null,
					]),
				);
			}
			previousSnapshot = snapshot;
		}

		if (!message.isUser && !message.isSystem) {
			replies.push({ floor: message.index + 1, text: message.text });
		}
	}

	const otherBytes = rawBytes - bodyBytes - variablesBytes;
	const otherTokens = Math.max(0, totalTokens - bodyTokens - variablesTokens);
	const sortedFields = [...fieldSizes.entries()]
		.map(([field, bytes]) => ({ field, bytes }))
		.sort((left, right) => right.bytes - left.bytes);

	return {
		characterName,
		fileBytes: file.size,
		headerBytes,
		messageCount,
		roleCounts,
		swipeCount,
		bodyBytes,
		swipeBodyBytes,
		variablesBytes,
		otherBytes,
		rawBytes,
		bodyTokens,
		swipeBodyTokens,
		variablesTokens,
		otherTokens,
		fieldBytes: sortedFields,
		snapshotBytes,
		allSnapshotBytes,
		diffCount,
		diffBytes,
		assistantReplyCount: replies.length,
		duplication: analyzeDuplication(replies),
	};
}

function countRole(
	counts: { user: number; assistant: number; system: number },
	message: StChatMessage,
): void {
	if (message.isSystem) {
		counts.system += 1;
	} else if (message.isUser) {
		counts.user += 1;
	} else {
		counts.assistant += 1;
	}
}

function snapshotSize(value: JsonValue | null): number {
	const serialized = serializeValue(value);
	return serialized === null ? 0 : byteLength(serialized);
}

function serializeValue(value: JsonValue | undefined): string | null {
	if (value === undefined) return null;
	const serialized = JSON.stringify(value);
	return serialized === undefined ? null : serialized;
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}
