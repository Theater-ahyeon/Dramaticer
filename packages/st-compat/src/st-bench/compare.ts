import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ContextMessage, isJsonObject } from "@dramaticer/core";
import { parseCharacterCardFile } from "../character-card.js";
import { parseChatJsonl } from "../chat-jsonl.js";
import { parsePresetFile } from "../preset.js";
import {
	type FaithfulChatMessage,
	type FaithfulUnsupportedFeature,
	assembleFaithfulRequest,
} from "./faithful.js";
import {
	assertBatchDir,
	latestSandboxRunEntries,
	readSandboxRunManifest,
} from "./plan.js";
import { isPathInside } from "./sandbox.js";

/** 参与比对的采样参数；模型名与流式开关不参与。 */
export interface BenchmarkSampling {
	readonly temperature: number | null;
	readonly topP: number | null;
	readonly maxTokens: number | null;
	readonly frequencyPenalty: number | null;
	readonly presencePenalty: number | null;
}

export interface NormalizedMessage {
	readonly role: string;
	readonly contentHash: string;
	readonly contentLength: number;
}

export interface NormalizedRequest {
	readonly messages: readonly NormalizedMessage[];
	readonly sampling: BenchmarkSampling;
	/** 流式开关只记录，不参与比较。 */
	readonly stream: boolean | null;
	/** 录制请求里出现、但当前比对口径不覆盖的采样字段。 */
	readonly ignoredParameters: readonly string[];
}

export type ComparisonDiffReason =
	| "message-missing"
	| "message-extra"
	| "role-mismatch"
	| "content-mismatch"
	| "sampling-mismatch"
	| "unsupported-feature";

export interface ComparisonDiff {
	readonly path: string;
	readonly reason: ComparisonDiffReason;
	/** 只写哈希、长度、角色与参数值，不写正文。 */
	readonly detail: string;
}

export interface ComparisonMeta {
	readonly combinationId: string;
	readonly seq: number;
}

export interface RequestComparison {
	readonly combinationId: string;
	readonly seq: number;
	readonly expected: NormalizedRequest;
	readonly actual: NormalizedRequest;
	readonly matchedMessages: number;
	readonly messageCoverage: number;
	readonly comparedSamplingFields: number;
	readonly matchedSamplingFields: number;
	readonly diffs: readonly ComparisonDiff[];
	readonly unsupported: readonly FaithfulUnsupportedFeature[];
	readonly expectedHash: string;
	readonly actualHash: string;
}

export interface ComparisonSummary {
	readonly requests: number;
	readonly expectedMessages: number;
	readonly actualMessages: number;
	readonly matchedMessages: number;
	readonly messageCoverage: number;
	readonly comparedSamplingFields: number;
	readonly matchedSamplingFields: number;
	readonly diffCount: number;
	readonly unsupportedCount: number;
}

const SAMPLING_FIELDS: readonly (readonly [keyof BenchmarkSampling, string])[] =
	[
		["temperature", "temperature"],
		["topP", "top_p"],
		["maxTokens", "max_tokens"],
		["frequencyPenalty", "frequency_penalty"],
		["presencePenalty", "presence_penalty"],
	];

const IGNORED_SAMPLING_FIELDS: readonly string[] = [
	"top_k",
	"top_a",
	"min_p",
	"repetition_penalty",
	"seed",
	"n",
	"reasoning_effort",
	"assistant_impersonation",
];

const MESSAGE_ROLES: Readonly<Record<string, true>> = {
	system: true,
	user: true,
	assistant: true,
};

const DIFF_REASONS: Readonly<Record<string, ComparisonDiffReason>> = {
	"message-missing": "message-missing",
	"message-extra": "message-extra",
	"role-mismatch": "role-mismatch",
	"content-mismatch": "content-mismatch",
	"sampling-mismatch": "sampling-mismatch",
	"unsupported-feature": "unsupported-feature",
};

/** 把一条 OpenAI 兼容请求正文规范化成只含角色、正文哈希与采样参数的结构。 */
export function normalizeRecordedBody(body: unknown): NormalizedRequest {
	if (!isJsonObject(body)) {
		throw new Error("录制请求正文必须是 JSON 对象");
	}
	const messages = normalizeMessages(body.messages, "录制请求");
	const sampling = normalizeSampling(body, "录制请求");
	const stream = body.stream;
	if (stream !== undefined && stream !== null && typeof stream !== "boolean") {
		throw new Error("录制请求的 stream 必须是布尔值");
	}
	const ignoredParameters = IGNORED_SAMPLING_FIELDS.filter(
		(key) => body[key] !== undefined && body[key] !== null,
	);
	return {
		messages,
		sampling,
		stream: stream ?? null,
		ignoredParameters,
	};
}

/** 把 Dramaticer 组装出的消息规范化；采样参数直接来自忠实模式。 */
export function normalizeAssembledRequest(input: {
	readonly messages: readonly ContextMessage[];
	readonly sampling: BenchmarkSampling;
}): NormalizedRequest {
	return {
		messages: input.messages.map((message) => ({
			role: message.role,
			contentHash: hashContent(message.content),
			contentLength: message.content.length,
		})),
		sampling: input.sampling,
		stream: null,
		ignoredParameters: [],
	};
}

function normalizeMessages(
	value: unknown,
	label: string,
): readonly NormalizedMessage[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label}的 messages 必须是数组`);
	}
	return value.map((item, index) => {
		if (!isJsonObject(item)) {
			throw new Error(`${label}的 messages[${index}] 不是对象`);
		}
		const role = item.role;
		if (typeof role !== "string" || MESSAGE_ROLES[role] !== true) {
			throw new Error(
				`${label}的 messages[${index}].role 必须是 system、user 或 assistant`,
			);
		}
		const content = item.content;
		if (typeof content !== "string") {
			throw new Error(`${label}的 messages[${index}].content 必须是字符串`);
		}
		return {
			role,
			contentHash: hashContent(content),
			contentLength: content.length,
		};
	});
}

function normalizeSampling(
	source: Record<string, unknown>,
	label: string,
): BenchmarkSampling {
	return {
		temperature: readSamplingNumber(source, "temperature", label),
		topP: readSamplingNumber(source, "top_p", label),
		maxTokens: readSamplingNumber(source, "max_tokens", label),
		frequencyPenalty: readSamplingNumber(source, "frequency_penalty", label),
		presencePenalty: readSamplingNumber(source, "presence_penalty", label),
	};
}

function readSamplingNumber(
	source: Record<string, unknown>,
	key: string,
	label: string,
): number | null {
	const value = source[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${label}的 ${key} 必须是有限数字`);
	}
	return value;
}

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/** 逐位比较消息、角色与采样参数；正文只以哈希和长度出现。 */
export function compareRequests(
	meta: ComparisonMeta,
	expected: NormalizedRequest,
	actual: NormalizedRequest,
	unsupported: readonly FaithfulUnsupportedFeature[],
): RequestComparison {
	const diffs: ComparisonDiff[] = [];
	const total = Math.max(expected.messages.length, actual.messages.length);
	let matchedMessages = 0;
	for (let index = 0; index < total; index += 1) {
		const left = expected.messages[index];
		const right = actual.messages[index];
		const location = `messages[${index}]`;
		if (left === undefined && right !== undefined) {
			diffs.push({
				path: location,
				reason: "message-extra",
				detail: describeMessage(right),
			});
			continue;
		}
		if (left !== undefined && right === undefined) {
			diffs.push({
				path: location,
				reason: "message-missing",
				detail: describeMessage(left),
			});
			continue;
		}
		if (left === undefined || right === undefined) continue;
		if (left.role !== right.role) {
			diffs.push({
				path: location,
				reason: "role-mismatch",
				detail: `expected=${left.role} actual=${right.role} hash=${shortHash(left.contentHash)}`,
			});
			continue;
		}
		if (left.contentHash !== right.contentHash) {
			diffs.push({
				path: `${location}.content`,
				reason: "content-mismatch",
				detail: `expectedHash=${shortHash(left.contentHash)} actualHash=${shortHash(right.contentHash)} expectedLength=${left.contentLength} actualLength=${right.contentLength}`,
			});
			continue;
		}
		matchedMessages += 1;
	}

	let comparedSamplingFields = 0;
	let matchedSamplingFields = 0;
	for (const [key] of SAMPLING_FIELDS) {
		const left = expected.sampling[key];
		const right = actual.sampling[key];
		if (left === null && right === null) continue;
		comparedSamplingFields += 1;
		if (left === right) {
			matchedSamplingFields += 1;
			continue;
		}
		diffs.push({
			path: `sampling.${key}`,
			reason: "sampling-mismatch",
			detail: `expected=${String(left)} actual=${String(right)}`,
		});
	}

	for (const feature of unsupported) {
		diffs.push({
			path: `features.${feature.feature}`,
			reason: "unsupported-feature",
			detail: feature.detail,
		});
	}
	for (const parameter of expected.ignoredParameters) {
		diffs.push({
			path: `sampling.${parameter}`,
			reason: "unsupported-feature",
			detail: "recorded-only",
		});
	}

	return {
		combinationId: meta.combinationId,
		seq: meta.seq,
		expected,
		actual,
		matchedMessages,
		messageCoverage:
			expected.messages.length === 0
				? actual.messages.length === 0
					? 1
					: 0
				: matchedMessages / expected.messages.length,
		comparedSamplingFields,
		matchedSamplingFields,
		diffs,
		unsupported,
		expectedHash: structuralHash(expected),
		actualHash: structuralHash(actual),
	};
}

function describeMessage(message: NormalizedMessage): string {
	return `role=${message.role} hash=${shortHash(message.contentHash)} length=${message.contentLength}`;
}

function shortHash(hash: string): string {
	return hash.slice(0, 16);
}

function structuralHash(request: NormalizedRequest): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				messages: request.messages,
				sampling: request.sampling,
				ignoredParameters: request.ignoredParameters,
			}),
		)
		.digest("hex");
}

export function summarizeComparisons(
	comparisons: readonly RequestComparison[],
): ComparisonSummary {
	const expectedMessages = comparisons.reduce(
		(total, item) => total + item.expected.messages.length,
		0,
	);
	const actualMessages = comparisons.reduce(
		(total, item) => total + item.actual.messages.length,
		0,
	);
	const matchedMessages = comparisons.reduce(
		(total, item) => total + item.matchedMessages,
		0,
	);
	const comparedSamplingFields = comparisons.reduce(
		(total, item) => total + item.comparedSamplingFields,
		0,
	);
	const matchedSamplingFields = comparisons.reduce(
		(total, item) => total + item.matchedSamplingFields,
		0,
	);
	return {
		requests: comparisons.length,
		expectedMessages,
		actualMessages,
		matchedMessages,
		messageCoverage:
			expectedMessages === 0
				? actualMessages === 0
					? 1
					: 0
				: matchedMessages / expectedMessages,
		comparedSamplingFields,
		matchedSamplingFields,
		diffCount: comparisons.reduce(
			(total, item) => total + item.diffs.length,
			0,
		),
		unsupportedCount: comparisons.reduce(
			(total, item) => total + item.unsupported.length,
			0,
		),
	};
}

export interface ComparisonReportInput {
	readonly batch: string;
	readonly generatedAt: string;
	readonly comparisons: readonly RequestComparison[];
}

/** 报告只写统计、哈希与条目标识；不含提示词与对话正文。 */
export function renderComparisonReport(input: ComparisonReportInput): string {
	const summary = summarizeComparisons(input.comparisons);
	const lines: string[] = [];
	lines.push("# ST ↔ Dramaticer 请求比对报告");
	lines.push("");
	lines.push(`- 批次：${input.batch}`);
	lines.push(`- 生成时间：${input.generatedAt}`);
	lines.push(`- 请求数：${summary.requests}`);
	lines.push("");
	lines.push("## 覆盖率口径");
	lines.push("");
	lines.push(
		"- 消息覆盖率 = 位置、角色与正文哈希都一致的消息数 / ST 录制请求的消息数。",
	);
	lines.push(
		"- 采样参数覆盖率 = 一致且双方都出现的参数个数 / 双方至少一侧出现的参数个数。",
	);
	lines.push(
		"- 逐位比较消息与角色；模型名与流式开关不参与比较，其余采样字段记为不支持。",
	);
	lines.push(
		"- 忠实模式关闭记忆、台账、导演、写作契约等原生功能，只映射预设条目、角色卡字段、聊天历史与预填充。",
	);
	lines.push(
		"- 无法映射的预设功能列入「不支持」，不计入已支持功能的差异；差异逐条列出路径、原因与哈希。",
	);
	lines.push("");
	lines.push("## 总计");
	lines.push("");
	lines.push(`- ST 消息：${summary.expectedMessages}`);
	lines.push(`- Dramaticer 消息：${summary.actualMessages}`);
	lines.push(`- 匹配消息：${summary.matchedMessages}`);
	lines.push(`- 消息覆盖率：${formatPercent(summary.messageCoverage)}`);
	lines.push(
		`- 采样参数：${summary.matchedSamplingFields}/${summary.comparedSamplingFields} 一致`,
	);
	lines.push(`- 差异：${summary.diffCount}`);
	lines.push(`- 不支持功能：${summary.unsupportedCount}`);
	lines.push("");
	lines.push("## 逐请求");
	lines.push("");
	lines.push(
		"| 组合 | 序号 | ST 消息 | Dramaticer 消息 | 匹配 | 覆盖率 | 差异 | 不支持 | ST 结构哈希 | Dramaticer 结构哈希 |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|");
	for (const item of input.comparisons) {
		lines.push(
			`| ${item.combinationId} | ${item.seq} | ${item.expected.messages.length} | ${item.actual.messages.length} | ${item.matchedMessages} | ${formatPercent(item.messageCoverage)} | ${item.diffs.length} | ${item.unsupported.length} | ${shortHash(item.expectedHash)} | ${shortHash(item.actualHash)} |`,
		);
	}
	lines.push("");
	lines.push("## 差异原因");
	lines.push("");
	const reasonCounts = countBy(
		input.comparisons.flatMap((item) => item.diffs.map((diff) => diff.reason)),
	);
	for (const [reason, count] of reasonCounts) {
		lines.push(`- ${reason}：${count}`);
	}
	lines.push("");
	lines.push("## 不支持功能");
	lines.push("");
	const featureCounts = countBy(
		input.comparisons.flatMap((item) =>
			item.unsupported.map((feature) => feature.feature),
		),
	);
	for (const [feature, count] of featureCounts) {
		lines.push(`- ${feature}：${count}`);
	}
	lines.push("");
	lines.push("## 逐条差异");
	lines.push("");
	const listed = input.comparisons.flatMap((item) =>
		item.diffs.map((diff) => ({ ...diff, ...item })),
	);
	const limit = 200;
	for (const diff of listed.slice(0, limit)) {
		lines.push(
			`- ${diff.combinationId} 序号 ${diff.seq} ${diff.path} ${diff.reason} ${diff.detail}`,
		);
	}
	if (listed.length > limit) {
		lines.push(`- 其余 ${listed.length - limit} 条差异见 diffs.jsonl`);
	}
	lines.push("");
	return lines.join("\n");
}

function formatPercent(value: number): string {
	return `${(value * 100).toFixed(2)}%`;
}

function countBy(
	values: readonly string[],
): readonly (readonly [string, number])[] {
	const counts = new Map<string, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return [...counts.entries()].sort((left, right) => {
		const byCount = right[1] - left[1];
		return byCount !== 0 ? byCount : left[0].localeCompare(right[0]);
	});
}

export interface CompareSandboxBatchOptions {
	/** 沙箱副本目录，必须位于私有根目录内部。 */
	readonly sandboxDir: string;
	readonly privateRoot: string;
	readonly batchDir: string;
	readonly limit?: number;
	readonly log?: (message: string) => void;
}

export interface CompareSandboxBatchResult {
	readonly combinations: number;
	readonly requests: number;
	readonly reportFile: string;
	readonly diffsFile: string;
	readonly summary: ComparisonSummary;
}

interface RecordingIndexEntry {
	readonly seq: number;
	readonly file: string;
}

/**
 * 按 run 清单里 completed 行的序号区间读取录制请求，
 * 用同一份预设、角色卡与聊天片段组装忠实请求后逐条比较。
 */
export async function compareSandboxBatch(
	options: CompareSandboxBatchOptions,
): Promise<CompareSandboxBatchResult> {
	const log = options.log ?? (() => undefined);
	const sandboxDir = path.resolve(options.sandboxDir);
	if (!isPathInside(sandboxDir, options.privateRoot)) {
		throw new Error(
			`沙箱目录必须在私有根目录 ${options.privateRoot} 内部，收到 ${sandboxDir}`,
		);
	}
	assertBatchDir(options.batchDir, options.privateRoot);
	const dataRoot = path.join(sandboxDir, "data", "default-user");
	const entries = [
		...latestSandboxRunEntries(
			await readSandboxRunManifest(options.batchDir),
		).values(),
	].filter(
		(entry) =>
			entry.status === "completed" &&
			entry.seqStart !== null &&
			entry.seqEnd !== null,
	);
	if (entries.length === 0) {
		throw new Error("批次里没有已完成的组合");
	}
	const limited =
		options.limit === undefined ? entries : entries.slice(0, options.limit);
	const recordings = await readRecordingIndex(options.batchDir);
	const comparisons: RequestComparison[] = [];

	for (const entry of limited) {
		log(
			`比对组合 ${entry.combinationId}：${entry.preset} / ${entry.character} / ${entry.chat}`,
		);
		const preset = await parsePresetFile(
			resolveInside(
				path.join(dataRoot, "OpenAI Settings"),
				`${entry.preset}.json`,
			),
		);
		const character = await parseCharacterCardFile(
			await resolveCharacterCard(
				path.join(dataRoot, "characters"),
				entry.character,
			),
		);
		const chat = await readChatMessages(
			resolveInside(path.join(dataRoot, "chats"), ...entry.chat.split("/")),
		);
		const assembled = await assembleFaithfulRequest({
			preset,
			character,
			chat: chat.messages,
			userName: chat.userName,
		});
		const actual = normalizeAssembledRequest({
			messages: assembled.request.messages,
			sampling: assembled.request.sampling,
		});
		for (
			let seq = entry.seqStart as number;
			seq <= (entry.seqEnd as number);
			seq += 1
		) {
			const file = recordings.get(seq);
			if (file === undefined) {
				throw new Error(
					`录制索引里没有序号 ${seq}（组合 ${entry.combinationId}）`,
				);
			}
			const record = await readJsonFile(file);
			if (!isJsonObject(record) || record.body === null) {
				throw new Error(`录制请求缺少正文：${file}`);
			}
			const expected = normalizeRecordedBody(record.body);
			comparisons.push(
				compareRequests(
					{ combinationId: entry.combinationId, seq },
					expected,
					actual,
					assembled.unsupported,
				),
			);
		}
	}

	const outDir = path.join(options.batchDir, "compare");
	await mkdir(outDir, { recursive: true });
	const diffsFile = path.join(outDir, "diffs.jsonl");
	const diffLines = comparisons.flatMap((item) =>
		item.diffs.map((diff) =>
			JSON.stringify({
				combinationId: item.combinationId,
				seq: item.seq,
				path: diff.path,
				reason: diff.reason,
				detail: diff.detail,
			}),
		),
	);
	await writeFile(
		diffsFile,
		diffLines.length === 0 ? "" : `${diffLines.join("\n")}\n`,
		"utf8",
	);
	const reportFile = path.join(outDir, "report.md");
	const batchName = path.basename(path.resolve(options.batchDir));
	await writeFile(
		reportFile,
		renderComparisonReport({
			batch: batchName,
			generatedAt: new Date().toISOString(),
			comparisons,
		}),
		"utf8",
	);
	const summary = summarizeComparisons(comparisons);
	await writeFile(
		path.join(outDir, "summary.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
		"utf8",
	);
	return {
		combinations: limited.length,
		requests: comparisons.length,
		reportFile,
		diffsFile,
		summary,
	};
}

async function readRecordingIndex(
	batchDir: string,
): Promise<ReadonlyMap<number, string>> {
	const indexFile = path.join(batchDir, "index.jsonl");
	const text = await readFile(indexFile, "utf8");
	const entries = new Map<number, string>();
	for (const [lineNumber, line] of text.split("\n").entries()) {
		if (line.trim() === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`${indexFile} 第 ${lineNumber + 1} 行不是合法 JSON`);
		}
		if (!isJsonObject(parsed)) {
			throw new Error(`${indexFile} 第 ${lineNumber + 1} 行不是对象`);
		}
		const seq = parsed.seq;
		const file = parsed.file;
		if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
			throw new Error(`${indexFile} 第 ${lineNumber + 1} 行的 seq 非法`);
		}
		if (typeof file !== "string" || file === "") {
			throw new Error(`${indexFile} 第 ${lineNumber + 1} 行的 file 非法`);
		}
		entries.set(seq, resolveInside(batchDir, file));
	}
	return entries;
}

async function readChatMessages(file: string): Promise<{
	readonly messages: readonly FaithfulChatMessage[];
	readonly userName: string | null;
}> {
	const messages: FaithfulChatMessage[] = [];
	let userName: string | null = null;
	for await (const entry of parseChatJsonl(
		createReadStream(file, { encoding: "utf8" }),
		{ strictSwipeId: false },
	)) {
		if (entry.kind === "header") {
			userName = entry.header.userName;
			continue;
		}
		const role = entry.message.isSystem
			? "system"
			: entry.message.isUser
				? "user"
				: "assistant";
		messages.push({ role, content: entry.message.text });
	}
	return { messages, userName };
}

async function resolveCharacterCard(
	charactersDir: string,
	character: string,
): Promise<string> {
	for (const extension of [".png", ".json"]) {
		const file = resolveInside(charactersDir, `${character}${extension}`);
		const exists = await stat(file).then(
			(info) => info.isFile(),
			() => false,
		);
		if (exists) return file;
	}
	throw new Error(`沙箱里找不到角色卡：${character}`);
}

function resolveInside(
	baseDir: string,
	...segments: readonly string[]
): string {
	const resolved = path.resolve(baseDir, ...segments);
	if (!isPathInside(resolved, baseDir)) {
		throw new Error(`路径不在 ${baseDir} 内部：${resolved}`);
	}
	return resolved;
}

async function readJsonFile(file: string): Promise<unknown> {
	const text = await readFile(file, "utf8");
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${file} 不是合法 JSON`, { cause: error });
	}
}

/** 把 diffs.jsonl 读回结构化记录；测试与后续汇总使用。 */
export function parseComparisonDiffLine(
	line: string,
	label: string,
): ComparisonDiff & ComparisonMeta {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		throw new Error(`${label} 不是合法 JSON`);
	}
	if (!isJsonObject(parsed)) throw new Error(`${label} 不是对象`);
	const combinationId = parsed.combinationId;
	const seq = parsed.seq;
	const reason = parsed.reason;
	const diffPath = parsed.path;
	const detail = parsed.detail;
	if (typeof combinationId !== "string" || combinationId === "") {
		throw new Error(`${label} 的 combinationId 非法`);
	}
	if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0) {
		throw new Error(`${label} 的 seq 非法`);
	}
	if (typeof reason !== "string" || DIFF_REASONS[reason] === undefined) {
		throw new Error(`${label} 的 reason 非法`);
	}
	if (typeof diffPath !== "string" || diffPath === "") {
		throw new Error(`${label} 的 path 非法`);
	}
	if (typeof detail !== "string") {
		throw new Error(`${label} 的 detail 非法`);
	}
	return {
		combinationId,
		seq,
		path: diffPath,
		reason: reason as ComparisonDiffReason,
		detail,
	};
}
