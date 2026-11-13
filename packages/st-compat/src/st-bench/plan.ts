import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { isJsonObject } from "@dramaticer/core";
import { isPathInside } from "./sandbox.js";

export const RUN_MANIFEST_FILE = "manifest.jsonl";

const PRESET_DIR = "OpenAI Settings";
const CHARACTER_EXTENSIONS: Record<string, true> = {
	".json": true,
	".png": true,
};
const CHAT_EXTENSION = ".jsonl";
/** 驱动把片段复制成 `bench-<组合 id>.jsonl` 放进角色卡目录；这些副本不算输入。 */
const BENCH_CHAT_PATTERN = /^bench-[0-9a-f]{32}\.jsonl$/i;

const RUN_STATUSES = {
	pending: true,
	running: true,
	completed: true,
	failed: true,
} as const;

export type SandboxRunStatus = keyof typeof RUN_STATUSES;

function isRunStatus(value: unknown): value is SandboxRunStatus {
	return typeof value === "string" && Object.hasOwn(RUN_STATUSES, value);
}

export interface SandboxChatInput {
	/** 相对 chats 目录的 posix 路径，例如 `alice/chat.jsonl`。 */
	readonly id: string;
	/** 非空消息行数；JSONL 首行的 chat_metadata 不算一楼层。 */
	readonly floor: number;
}

export interface SandboxBenchInputs {
	readonly presets: readonly string[];
	readonly characters: readonly string[];
	readonly chats: readonly SandboxChatInput[];
}

export interface SandboxCombination {
	readonly combinationId: string;
	readonly preset: string;
	readonly character: string;
	readonly chat: string;
	readonly floor: number;
}

export interface SandboxRunEntry {
	readonly combinationId: string;
	readonly preset: string;
	readonly character: string;
	readonly chat: string;
	readonly floor: number;
	/** 录制索引的起止序号；未开始或请求体超限时为空。 */
	readonly seqStart: number | null;
	readonly seqEnd: number | null;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
	readonly status: SandboxRunStatus;
	readonly reason?: string;
}

export interface DiscoverSandboxInputsOptions {
	/** 沙箱里的 `data/default-user` 目录。 */
	readonly dataRoot: string;
}

export interface SandboxPlanOptions {
	/** 最多生成的组合数；缺省为三份清单长度的最大值，保证每个输入至少出现一次。 */
	readonly limit?: number;
}

export interface SandboxPlanWriteResult {
	readonly total: number;
	readonly created: number;
	readonly completed: number;
	readonly pending: number;
	readonly retried: number;
}

/**
 * 读出沙箱里的预设、角色卡与聊天片段。只保留文件名、路径与楼层统计，
 * 聊天正文不会离开这个函数。
 */
export async function discoverSandboxInputs(
	options: DiscoverSandboxInputsOptions,
): Promise<SandboxBenchInputs> {
	const dataRoot = path.resolve(options.dataRoot);
	const presets = await listPresets(path.join(dataRoot, PRESET_DIR));
	const characters = await listCharacters(path.join(dataRoot, "characters"));
	const chats = await listChats(path.join(dataRoot, "chats"));
	if (presets.length === 0) {
		throw new Error(`沙箱里没有预设：${path.join(dataRoot, PRESET_DIR)}`);
	}
	if (characters.length === 0) {
		throw new Error(`沙箱里没有角色卡：${path.join(dataRoot, "characters")}`);
	}
	if (chats.length === 0) {
		throw new Error(`沙箱里没有聊天片段：${path.join(dataRoot, "chats")}`);
	}
	return { presets, characters, chats };
}

/**
 * 三份清单按稳定顺序轮转配对：第 i 个组合取第 i % 长度 项。
 * 组合数取三份清单长度的最大值，因此每个预设、角色卡与聊天片段至少出现一次；
 * 同一份沙箱数据得到逐项相同的组合与组合 id。
 */
export function planSandboxCombinations(
	inputs: SandboxBenchInputs,
	options: SandboxPlanOptions = {},
): readonly SandboxCombination[] {
	const limit = options.limit;
	if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
		throw new Error(`组合上限必须是正整数，收到 ${limit}`);
	}
	const total = Math.max(
		inputs.presets.length,
		inputs.characters.length,
		inputs.chats.length,
	);
	const count = limit === undefined ? total : Math.min(limit, total);
	const combinations: SandboxCombination[] = [];
	const seen: Record<string, true> = {};
	for (let index = 0; index < count; index += 1) {
		const preset = inputs.presets[index % inputs.presets.length] ?? "";
		const character = inputs.characters[index % inputs.characters.length] ?? "";
		const chat = inputs.chats[index % inputs.chats.length];
		if (chat === undefined) throw new Error("聊天片段清单为空");
		const combination: SandboxCombination = {
			combinationId: combinationId(preset, character, chat.id),
			preset,
			character,
			chat: chat.id,
			floor: chat.floor,
		};
		if (seen[combination.combinationId] === true) {
			throw new Error(`组合 id 重复：${combination.combinationId}`);
		}
		seen[combination.combinationId] = true;
		combinations.push(combination);
	}
	return combinations;
}

/** 组合 id 由预设、角色卡与聊天片段的名字决定，不包含时间与批次。 */
export function combinationId(
	preset: string,
	character: string,
	chat: string,
): string {
	return createHash("sha256")
		.update(`${preset}\u0000${character}\u0000${chat}`)
		.digest("hex")
		.slice(0, 32);
}

/** 读取 run 清单；文件不存在时返回空数组。 */
export async function readSandboxRunManifest(
	batchDir: string,
): Promise<readonly SandboxRunEntry[]> {
	const manifestFile = path.join(batchDir, RUN_MANIFEST_FILE);
	let text: string;
	try {
		text = await readFile(manifestFile, "utf8");
	} catch (error: unknown) {
		if (isMissingFile(error)) return [];
		throw error;
	}
	const entries: SandboxRunEntry[] = [];
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line.trim() === "") continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			throw new Error(`${manifestFile} 第 ${index + 1} 行不是合法 JSON`);
		}
		entries.push(parseRunEntry(parsed, `${manifestFile} 第 ${index + 1} 行`));
	}
	return entries;
}

/** 每个组合的最后一行代表当前状态；清单只追加，不原地改写。 */
export function latestSandboxRunEntries(
	entries: readonly SandboxRunEntry[],
): ReadonlyMap<string, SandboxRunEntry> {
	const latest = new Map<string, SandboxRunEntry>();
	for (const entry of entries) latest.set(entry.combinationId, entry);
	return latest;
}

/**
 * 写入组合计划：没有记录的组合补一条 pending；已完成组合跳过；
 * running 表示上次中断，failed 表示上次失败，两者都补一条 pending 重试。
 */
export async function writeSandboxPlan(options: {
	readonly batchDir: string;
	readonly privateRoot: string;
	readonly combinations: readonly SandboxCombination[];
}): Promise<SandboxPlanWriteResult> {
	assertBatchDir(options.batchDir, options.privateRoot);
	const existing = await readSandboxRunManifest(options.batchDir);
	const latest = latestSandboxRunEntries(existing);
	const rows: SandboxRunEntry[] = [];
	let created = 0;
	let completed = 0;
	let pending = 0;
	let retried = 0;
	for (const combination of options.combinations) {
		const previous = latest.get(combination.combinationId);
		if (previous !== undefined) {
			assertSameCombination(previous, combination);
			if (previous.status === "completed") {
				completed += 1;
				continue;
			}
			if (previous.status === "pending") {
				pending += 1;
				continue;
			}
			retried += 1;
		} else {
			created += 1;
		}
		rows.push({
			combinationId: combination.combinationId,
			preset: combination.preset,
			character: combination.character,
			chat: combination.chat,
			floor: combination.floor,
			seqStart: null,
			seqEnd: null,
			startedAt: null,
			finishedAt: null,
			status: "pending",
		});
	}
	await appendRunEntries(options.batchDir, rows);
	return {
		total: options.combinations.length,
		created,
		completed,
		pending,
		retried,
	};
}

/** 追加一条状态记录；驱动用 running 与 completed/failed 两行包住一次生成。 */
export async function appendSandboxRunEntry(options: {
	readonly batchDir: string;
	readonly privateRoot: string;
	readonly entry: SandboxRunEntry;
}): Promise<void> {
	assertBatchDir(options.batchDir, options.privateRoot);
	const entry = parseRunEntry(options.entry, "run 清单条目");
	const latest = latestSandboxRunEntries(
		await readSandboxRunManifest(options.batchDir),
	);
	const previous = latest.get(entry.combinationId);
	if (previous !== undefined) assertSameCombination(previous, entry);
	await appendRunEntries(options.batchDir, [entry]);
}

/** 把录制索引里的序号对应回组合；不在任何组合范围内时返回 null。 */
export function findSandboxRunEntryBySeq(
	entries: readonly SandboxRunEntry[],
	seq: number,
): SandboxRunEntry | null {
	if (!Number.isInteger(seq) || seq < 0) {
		throw new Error(`录制序号必须是非负整数，收到 ${seq}`);
	}
	for (const entry of entries) {
		if (entry.seqStart === null || entry.seqEnd === null) continue;
		if (seq >= entry.seqStart && seq <= entry.seqEnd) return entry;
	}
	return null;
}

/** 批次目录必须在私有根目录内部；清单与录制数据都不能进入提交。 */
export function assertBatchDir(batchDir: string, privateRoot: string): void {
	const dir = path.resolve(batchDir);
	const root = path.resolve(privateRoot);
	if (dir === root) throw new Error("批次目录不能就是私有根目录本身");
	if (!isPathInside(dir, root)) {
		throw new Error(`批次目录必须在私有根目录 ${root} 内部，收到 ${dir}`);
	}
}

/** 批次名会变成目录名，只允许字母、数字、点、下划线与短横线。 */
export function assertBatchName(batch: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(batch) || batch === "." || batch === "..") {
		throw new Error(
			`批次名只允许字母、数字、点、下划线与短横线，收到 ${batch}`,
		);
	}
	return batch;
}

async function appendRunEntries(
	batchDir: string,
	rows: readonly SandboxRunEntry[],
): Promise<void> {
	if (rows.length === 0) return;
	await mkdir(batchDir, { recursive: true });
	const text = rows.map((row) => `${JSON.stringify(row)}\n`).join("");
	await appendFile(path.join(batchDir, RUN_MANIFEST_FILE), text, "utf8");
}

function parseRunEntry(value: unknown, label: string): SandboxRunEntry {
	if (!isJsonObject(value)) throw new Error(`${label} 不是对象`);
	const combinationId = readString(value, "combinationId", label);
	const preset = readString(value, "preset", label);
	const character = readString(value, "character", label);
	const chat = readString(value, "chat", label);
	const floor = readInteger(value, "floor", label);
	if (floor < 0) throw new Error(`${label} 的 floor 不能为负数`);
	const status = value.status;
	if (!isRunStatus(status)) {
		throw new Error(`${label} 的 status 非法：${String(status)}`);
	}
	const seqStart = readNullableInteger(value, "seqStart", label);
	const seqEnd = readNullableInteger(value, "seqEnd", label);
	if (
		seqStart !== null &&
		seqEnd !== null &&
		(seqStart < 0 || seqEnd < seqStart)
	) {
		throw new Error(`${label} 的 seqStart/seqEnd 非法：${seqStart}..${seqEnd}`);
	}
	const startedAt = readNullableString(value, "startedAt", label);
	const finishedAt = readNullableString(value, "finishedAt", label);
	const reason = value.reason;
	if (reason !== undefined && typeof reason !== "string") {
		throw new Error(`${label} 的 reason 必须是字符串`);
	}
	return {
		combinationId,
		preset,
		character,
		chat,
		floor,
		seqStart,
		seqEnd,
		startedAt,
		finishedAt,
		status,
		...(reason === undefined ? {} : { reason }),
	};
}

function assertSameCombination(
	left: SandboxRunEntry | SandboxCombination,
	right: SandboxRunEntry | SandboxCombination,
): void {
	if (
		left.preset !== right.preset ||
		left.character !== right.character ||
		left.chat !== right.chat ||
		left.floor !== right.floor
	) {
		throw new Error(`组合 ${left.combinationId} 与清单里已有记录的输入不一致`);
	}
}

function readString(
	value: Record<string, unknown>,
	key: string,
	label: string,
): string {
	const field = value[key];
	if (typeof field !== "string" || field === "") {
		throw new Error(`${label} 的 ${key} 必须是非空字符串`);
	}
	return field;
}

function readInteger(
	value: Record<string, unknown>,
	key: string,
	label: string,
): number {
	const field = value[key];
	if (typeof field !== "number" || !Number.isInteger(field)) {
		throw new Error(`${label} 的 ${key} 必须是整数`);
	}
	return field;
}

function readNullableInteger(
	value: Record<string, unknown>,
	key: string,
	label: string,
): number | null {
	const field = value[key];
	if (field === null || field === undefined) return null;
	if (typeof field !== "number" || !Number.isInteger(field)) {
		throw new Error(`${label} 的 ${key} 必须是整数或 null`);
	}
	return field;
}

function readNullableString(
	value: Record<string, unknown>,
	key: string,
	label: string,
): string | null {
	const field = value[key];
	if (field === null || field === undefined) return null;
	if (typeof field !== "string" || field === "") {
		throw new Error(`${label} 的 ${key} 必须是非空字符串或 null`);
	}
	return field;
}

async function listPresets(dir: string): Promise<readonly string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const names: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const lowered = entry.name.toLowerCase();
		if (!lowered.endsWith(".json")) continue;
		const name = entry.name.slice(0, -".json".length);
		if (name === "") continue;
		names.push(name);
	}
	return names.sort(compareNames);
}

async function listCharacters(dir: string): Promise<readonly string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const names: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const lowered = entry.name.toLowerCase();
		const extension = path.extname(lowered);
		if (CHARACTER_EXTENSIONS[extension] !== true) continue;
		const name = entry.name.slice(0, entry.name.length - extension.length);
		if (name === "") continue;
		names.push(name);
	}
	return names.sort(compareNames);
}

async function listChats(dir: string): Promise<readonly SandboxChatInput[]> {
	const chats: SandboxChatInput[] = [];
	await walkChats(dir, dir, chats);
	chats.sort((left, right) => compareNames(left.id, right.id));
	return chats;
}

async function walkChats(
	root: string,
	current: string,
	output: SandboxChatInput[],
): Promise<void> {
	const entries = await readdir(current, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(current, entry.name);
		if (entry.isDirectory()) {
			await walkChats(root, fullPath, output);
			continue;
		}
		if (!entry.isFile()) continue;
		if (!entry.name.toLowerCase().endsWith(CHAT_EXTENSION)) continue;
		if (BENCH_CHAT_PATTERN.test(entry.name)) continue;
		const id = path.relative(root, fullPath).split(path.sep).join("/");
		output.push({ id, floor: await countChatFloors(fullPath) });
	}
}

/** 逐行流式统计，不会把整段对话读进内存，也不把正文带出函数。 */
async function countChatFloors(file: string): Promise<number> {
	const lines = createInterface({
		input: createReadStream(file, { encoding: "utf8" }),
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	let total = 0;
	let firstLine: string | null = null;
	try {
		for await (const line of lines) {
			if (line.trim() === "") continue;
			total += 1;
			if (firstLine === null) firstLine = line;
		}
	} finally {
		lines.close();
	}
	if (firstLine !== null && hasChatMetadata(firstLine)) total -= 1;
	return Math.max(total, 0);
}

function hasChatMetadata(line: string): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return false;
	}
	return isJsonObject(parsed) && parsed.chat_metadata !== undefined;
}

function compareNames(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
