import {
	copyFile,
	mkdir,
	readFile,
	readdir,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { type BrowserContext, type Page, chromium } from "@playwright/test";
import {
	DEFAULT_SANDBOX_SERVER_PORT,
	DEFAULT_STUB_MODEL,
	startSandboxServer,
} from "./launcher.js";
import {
	type SandboxCombination,
	type SandboxRunEntry,
	appendSandboxRunEntry,
	assertBatchDir,
	discoverSandboxInputs,
	latestSandboxRunEntries,
	planSandboxCombinations,
	readSandboxRunManifest,
	writeSandboxPlan,
} from "./plan.js";
import { type PromptRecordSummary, startPromptRecorder } from "./recorder.js";
import { isPathInside } from "./sandbox.js";

/** 与 `st-bench record` 的默认端口一致；沙箱端点指回这个地址。 */
export const DEFAULT_DRIVE_RECORDER_PORT = 8130;
export const DEFAULT_COMBINATION_TIMEOUT_MS = 180_000;
/** 一条生成请求从发出到索引落盘的等待上限。 */
const DEFAULT_RECORD_WAIT_MS = 15_000;

export interface SandboxDriveOptions {
	readonly sandboxDir: string;
	readonly privateRoot: string;
	/** 批次目录；录制索引与 run 清单都写在这里。 */
	readonly batchDir: string;
	readonly port?: number;
	readonly recorderPort?: number;
	/** 只驱动计划里的前若干个组合。 */
	readonly limit?: number;
	readonly stubModel?: string;
	/** 单个组合从选中到生成结束的时限。 */
	readonly combinationTimeoutMs?: number;
	readonly readinessTimeoutMs?: number;
	readonly headless?: boolean;
	readonly log?: (line: string) => void;
}

export interface SandboxDriveResult {
	readonly total: number;
	readonly completed: number;
	readonly failed: number;
	/** 上一次已经完成的组合数。 */
	readonly skipped: number;
}

export interface PreparedSandboxChat {
	/** 传给 `openCharacterChat` 的文件名，不含 `.jsonl`。 */
	readonly chatName: string;
	readonly file: string;
}

/**
 * 把聊天片段复制到当前角色卡自己的 chats 目录里，再打开这份副本。
 * ST 的对话目录按角色卡命名，片段与卡片轮转配对时不能直接跨目录读取；
 * 副本只落在沙箱里，原片段不变。
 */
export async function prepareSandboxChat(options: {
	readonly dataRoot: string;
	readonly combination: SandboxCombination;
}): Promise<PreparedSandboxChat> {
	const chatsRoot = path.join(options.dataRoot, "chats");
	const chatId = options.combination.chat;
	const segments = chatId.split("/");
	if (
		chatId === "" ||
		path.isAbsolute(chatId) ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new Error(`聊天片段路径不合法：${chatId}`);
	}
	const source = path.join(chatsRoot, ...segments);
	if (!isPathInside(source, chatsRoot)) {
		throw new Error(`聊天片段不在沙箱 chats 目录里：${chatId}`);
	}
	const character = options.combination.character;
	if (character === "" || character.includes("/") || character.includes("\\")) {
		throw new Error(`角色卡文件名不合法：${character}`);
	}
	// 组合里的角色卡名已经去掉扩展名，ST 的对话目录同样用这个名字。
	const avatarBase = character;
	const avatarDir = path.join(chatsRoot, avatarBase);
	if (!isPathInside(avatarDir, chatsRoot)) {
		throw new Error(`角色卡对话目录不在 chats 目录里：${avatarBase}`);
	}
	const chatName = `bench-${options.combination.combinationId}`;
	const file = path.join(avatarDir, `${chatName}.jsonl`);
	await mkdir(avatarDir, { recursive: true });
	await copyFile(source, file);
	return { chatName, file };
}

export interface PresetSanitizeResult {
	readonly total: number;
	readonly changed: number;
}

/**
 * 把沙箱里每个预设的连接字段改写成录制服务。切换预设时 ST 会先应用
 * 预设里的渠道并对它拉取模型列表，事后再改回内存设置已经晚了一步；
 * 预设生成参数与提示词保持原样，只有连接字段被覆盖。
 */
export async function sanitizeSandboxPresets(options: {
	readonly dataRoot: string;
	readonly endpointUrl: string;
	readonly stubModel: string;
}): Promise<PresetSanitizeResult> {
	const presetDir = path.join(options.dataRoot, "OpenAI Settings");
	const entries = await readdir(presetDir, { withFileTypes: true });
	let total = 0;
	let changed = 0;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json"))
			continue;
		total += 1;
		const file = path.join(presetDir, entry.name);
		const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error(`预设 ${entry.name} 不是 JSON 对象`);
		}
		const preset = parsed as Record<string, unknown>;
		const before = JSON.stringify(preset);
		preset.chat_completion_source = "custom";
		preset.custom_url = options.endpointUrl;
		preset.custom_model = options.stubModel;
		preset.reverse_proxy = "";
		preset.proxy_password = "";
		preset.custom_include_headers = "";
		if (JSON.stringify(preset) === before) continue;
		await writeFile(file, `${JSON.stringify(preset, null, 4)}\n`);
		changed += 1;
	}
	return { total, changed };
}

/**
 * 逐个组合驱动沙箱 ST 生成：每次切换预设、角色卡与片段，确认端点仍是
 * 录制服务后触发一次生成。失败的组合写原因后继续，已完成的组合跳过。
 */
export async function driveSandboxBatch(
	options: SandboxDriveOptions,
): Promise<SandboxDriveResult> {
	const privateRoot = path.resolve(options.privateRoot);
	const sandboxDir = path.resolve(options.sandboxDir);
	const batchDir = path.resolve(options.batchDir);
	assertBatchDir(batchDir, privateRoot);
	if (sandboxDir === privateRoot || !isPathInside(sandboxDir, privateRoot)) {
		throw new Error(
			`沙箱目录必须在私有根目录 ${privateRoot} 内部，收到 ${sandboxDir}`,
		);
	}
	const dataRoot = path.join(sandboxDir, "data", "default-user");
	const log = options.log ?? (() => {});
	const inputs = await discoverSandboxInputs({ dataRoot });
	const combinations = planSandboxCombinations(inputs, {
		limit: options.limit,
	});
	await writeSandboxPlan({ batchDir, privateRoot, combinations });
	const latest = latestSandboxRunEntries(
		await readSandboxRunManifest(batchDir),
	);
	const pending = combinations.filter(
		(combination) =>
			latest.get(combination.combinationId)?.status !== "completed",
	);
	const skipped = combinations.length - pending.length;
	log(
		`预设 ${inputs.presets.length} 个，角色卡 ${inputs.characters.length} 个，聊天片段 ${inputs.chats.length} 个`,
	);
	log(
		`组合 ${combinations.length} 个：待驱动 ${pending.length}，已完成 ${skipped}`,
	);
	if (pending.length === 0) {
		return {
			total: combinations.length,
			completed: 0,
			failed: 0,
			skipped,
		};
	}

	const stubModel = options.stubModel ?? DEFAULT_STUB_MODEL;
	const recorder = await startPromptRecorder({
		dir: batchDir,
		port: options.recorderPort ?? DEFAULT_DRIVE_RECORDER_PORT,
		stubModel,
	});
	let completed = 0;
	let failed = 0;
	try {
		const sanitized = await sanitizeSandboxPresets({
			dataRoot,
			endpointUrl: `${recorder.url}/v1`,
			stubModel,
		});
		log(
			`预设 ${sanitized.total} 个，连接字段指向录制服务 ${sanitized.changed} 个`,
		);
		const server = await startSandboxServer({
			sandboxDir,
			privateRoot,
			port: options.port ?? DEFAULT_SANDBOX_SERVER_PORT,
			endpointUrl: `${recorder.url}/v1`,
			stubModel,
			readinessTimeoutMs: options.readinessTimeoutMs,
			log: options.log,
		});
		try {
			const outcome = await runPendingCombinations({
				dataRoot,
				batchDir,
				privateRoot,
				serverUrl: server.url,
				endpointUrl: `${recorder.url}/v1`,
				stubModel,
				pending,
				combinationTimeoutMs:
					options.combinationTimeoutMs ?? DEFAULT_COMBINATION_TIMEOUT_MS,
				headless: options.headless ?? true,
				log,
			});
			completed = outcome.completed;
			failed = outcome.failed;
		} finally {
			await server.stop();
		}
	} finally {
		await recorder.close();
	}
	return {
		total: combinations.length,
		completed,
		failed,
		skipped,
	};
}

interface RunPendingOptions {
	readonly dataRoot: string;
	readonly batchDir: string;
	readonly privateRoot: string;
	readonly serverUrl: string;
	readonly endpointUrl: string;
	readonly stubModel: string;
	readonly pending: readonly SandboxCombination[];
	readonly combinationTimeoutMs: number;
	readonly headless: boolean;
	readonly log: (line: string) => void;
}

async function runPendingCombinations(
	options: RunPendingOptions,
): Promise<{ readonly completed: number; readonly failed: number }> {
	const browser = await chromium.launch({ headless: options.headless });
	let completed = 0;
	let failed = 0;
	try {
		const context = await browser.newContext();
		let page = await openBenchPage(context, options.serverUrl);
		for (let index = 0; index < options.pending.length; index += 1) {
			const combination = options.pending[index];
			if (combination === undefined) continue;
			const position = `${index + 1}/${options.pending.length}`;
			const beforeSeq = await lastRecordSeq(options.batchDir);
			const startedAt = new Date().toISOString();
			let prepared: PreparedSandboxChat;
			try {
				prepared = await prepareSandboxChat({
					dataRoot: options.dataRoot,
					combination,
				});
			} catch (error: unknown) {
				failed += 1;
				const reason = describeError(error);
				await appendEntry({
					batchDir: options.batchDir,
					privateRoot: options.privateRoot,
					combination,
					status: "failed",
					seqStart: null,
					seqEnd: null,
					startedAt,
					finishedAt: new Date().toISOString(),
					reason,
				});
				options.log(
					`组合 ${position} ${combination.combinationId} 失败：${reason}`,
				);
				continue;
			}
			await appendEntry({
				batchDir: options.batchDir,
				privateRoot: options.privateRoot,
				combination,
				status: "running",
				seqStart: beforeSeq + 1,
				seqEnd: null,
				startedAt,
				finishedAt: null,
			});
			try {
				await withTimeout(
					runBrowserTurn(page, {
						preset: combination.preset,
						avatar: combination.character,
						chatName: prepared.chatName,
						endpointUrl: options.endpointUrl,
						stubModel: options.stubModel,
					}),
					options.combinationTimeoutMs,
					`组合 ${combination.combinationId}`,
				);
				const records = await waitForRecordsAfter(
					options.batchDir,
					beforeSeq,
					DEFAULT_RECORD_WAIT_MS,
				);
				if (records.length === 0) {
					throw new Error("生成结束但没有产生请求记录");
				}
				const first = records[0];
				const last = records[records.length - 1];
				if (first === undefined || last === undefined) {
					throw new Error("录制索引为空");
				}
				await appendEntry({
					batchDir: options.batchDir,
					privateRoot: options.privateRoot,
					combination,
					status: "completed",
					seqStart: first.seq,
					seqEnd: last.seq,
					startedAt,
					finishedAt: new Date().toISOString(),
				});
				completed += 1;
				options.log(
					`组合 ${position} ${combination.combinationId} 完成：请求 ${first.seq}..${last.seq}`,
				);
			} catch (error: unknown) {
				const reason = describeError(error);
				const records = await recordsAfter(options.batchDir, beforeSeq);
				const first = records[0];
				const last = records[records.length - 1];
				await appendEntry({
					batchDir: options.batchDir,
					privateRoot: options.privateRoot,
					combination,
					status: "failed",
					seqStart: first?.seq ?? null,
					seqEnd: last?.seq ?? null,
					startedAt,
					finishedAt: new Date().toISOString(),
					reason,
				});
				failed += 1;
				options.log(
					`组合 ${position} ${combination.combinationId} 失败：${reason}`,
				);
				// 超时的生成可能还占着页面；换一张新页面继续。
				await page.close().catch(() => {});
				page = await openBenchPage(context, options.serverUrl);
			}
		}
		await page.close().catch(() => {});
		await context.close();
	} finally {
		await browser.close();
	}
	return { completed, failed };
}

async function openBenchPage(
	context: BrowserContext,
	serverUrl: string,
): Promise<Page> {
	const page = await context.newPage();
	await page.goto(serverUrl, {
		waitUntil: "domcontentloaded",
		timeout: 120_000,
	});
	await page.waitForFunction(
		() => {
			const scope = globalThis as unknown as {
				SillyTavern?: { getContext?: unknown };
			};
			return typeof scope.SillyTavern?.getContext === "function";
		},
		undefined,
		{ timeout: 120_000 },
	);
	return page;
}

interface BrowserTurnInput {
	readonly preset: string;
	readonly avatar: string;
	readonly chatName: string;
	readonly endpointUrl: string;
	readonly stubModel: string;
}

interface BrowserTurnResult {
	readonly preset: string;
	readonly avatar: string;
	readonly messageCount: number;
}

/**
 * 在页面里走 ST 前端自己的路径：切换预设、选中角色卡、打开片段、触发生成。
 * 函数整体注入页面执行，不依赖模块作用域里的任何值。
 */
async function runBrowserTurn(
	page: Page,
	input: BrowserTurnInput,
): Promise<BrowserTurnResult> {
	return page.evaluate(async (turn: BrowserTurnInput) => {
		interface Context {
			readonly characters: readonly { readonly avatar?: string }[];
			readonly characterId: number | undefined;
			readonly groupId: string | undefined;
			readonly chat: readonly unknown[];
			readonly chatCompletionSettings: Record<string, unknown>;
			selectCharacterById(id: number): Promise<void>;
			openCharacterChat(fileName: string): Promise<void>;
			generate(type: string): Promise<void>;
			saveSettingsDebounced(): void;
			getRequestHeaders(): Record<string, string>;
			readonly eventSource: {
				once(event: string, callback: () => void): unknown;
			};
			readonly eventTypes: Record<string, unknown>;
			getPresetManager(apiId: string):
				| {
						getPresetList(): { readonly preset_names: unknown };
						selectPreset(value: string): void;
				  }
				| null
				| undefined;
		}
		interface JQuery {
			val(value: string): JQuery;
			trigger(event: string): JQuery;
		}
		const scope = globalThis as unknown as {
			SillyTavern?: { getContext?: () => Context };
			$?: (selector: string) => JQuery;
			setTimeout: (callback: () => void, milliseconds: number) => unknown;
		};
		const sleep = (milliseconds: number): Promise<void> => {
			const { promise, resolve } = Promise.withResolvers<void>();
			scope.setTimeout(resolve, milliseconds);
			return promise;
		};
		if (typeof scope.SillyTavern?.getContext !== "function") {
			throw new Error("SillyTavern 前端没有加载");
		}
		if (typeof scope.$ !== "function") {
			throw new Error("SillyTavern 前端缺少 jQuery");
		}
		const $ = scope.$;
		const getContext = scope.SillyTavern.getContext;
		const context = getContext();

		async function readSavedSettings(): Promise<{
			readonly source: unknown;
			readonly customUrl: unknown;
			readonly model: unknown;
		}> {
			const response = await fetch("/api/settings/get", {
				method: "POST",
				headers: context.getRequestHeaders(),
				cache: "no-cache",
			});
			if (!response.ok) {
				throw new Error(`读取设置失败：HTTP ${response.status}`);
			}
			const payload: unknown = await response.json();
			if (
				typeof payload !== "object" ||
				payload === null ||
				!("settings" in payload) ||
				typeof payload.settings !== "string"
			) {
				throw new Error("设置响应里没有 settings 文本");
			}
			const parsed: unknown = JSON.parse(payload.settings);
			const settingsObject =
				typeof parsed === "object" &&
				parsed !== null &&
				"oai_settings" in parsed &&
				typeof parsed.oai_settings === "object" &&
				parsed.oai_settings !== null
					? parsed.oai_settings
					: null;
			return {
				source:
					settingsObject === null
						? undefined
						: Reflect.get(settingsObject, "chat_completion_source"),
				customUrl:
					settingsObject === null
						? undefined
						: Reflect.get(settingsObject, "custom_url"),
				model:
					settingsObject === null
						? undefined
						: Reflect.get(settingsObject, "custom_model"),
			};
		}

		const expectedSource = "custom";

		async function enforceRecorderEndpoint(): Promise<void> {
			const settings = context.chatCompletionSettings;
			settings.chat_completion_source = expectedSource;
			settings.custom_url = turn.endpointUrl;
			settings.custom_model = turn.stubModel;
			$("#chat_completion_source").val(expectedSource).trigger("change");
			$("#custom_api_url_text").val(turn.endpointUrl).trigger("input");
			$("#custom_model_id").val(turn.stubModel).trigger("input");
			context.saveSettingsDebounced();
			const saveDeadline = Date.now() + 8_000;
			for (;;) {
				const saved = await readSavedSettings();
				if (
					saved.source === expectedSource &&
					saved.customUrl === turn.endpointUrl &&
					saved.model === turn.stubModel
				) {
					return;
				}
				if (Date.now() >= saveDeadline) {
					throw new Error("保存后的端点不是录制服务");
				}
				await sleep(200);
			}
		}

		const managerDeadline = Date.now() + 30_000;
		let manager = getContext().getPresetManager("openai");
		while (manager === null || manager === undefined) {
			if (Date.now() >= managerDeadline) {
				throw new Error("预设管理器没有就绪");
			}
			await sleep(100);
			manager = getContext().getPresetManager("openai");
		}
		const presetDeadline = Date.now() + 30_000;
		let presetValue: unknown;
		for (;;) {
			const { preset_names } = manager.getPresetList();
			if (
				typeof preset_names === "object" &&
				preset_names !== null &&
				turn.preset in preset_names
			) {
				presetValue = Reflect.get(preset_names, turn.preset);
				break;
			}
			if (Date.now() >= presetDeadline) {
				throw new Error("预设没有出现在沙箱 ST 的列表里");
			}
			await sleep(250);
		}
		if (typeof presetValue !== "number" && typeof presetValue !== "string") {
			throw new Error("预设没有对应的选项值");
		}
		const presetEvent = Reflect.get(context.eventTypes, "PRESET_CHANGED");
		if (typeof presetEvent !== "string") {
			throw new Error("沙箱 ST 没有 PRESET_CHANGED 事件");
		}
		const applied = Promise.withResolvers<boolean>();
		context.eventSource.once(presetEvent, () => applied.resolve(true));
		manager.selectPreset(String(presetValue));
		const presetStart = Date.now();
		let appliedNow = false;
		while (!appliedNow) {
			appliedNow = await Promise.race([
				applied.promise,
				sleep(100).then(() => false),
			]);
			if (!appliedNow && Date.now() - presetStart >= 15_000) {
				throw new Error("切换预设超时");
			}
		}

		// 预设可能把连接改回真实渠道；生成前强制恢复录制端点并确认已保存。
		await enforceRecorderEndpoint();

		const characterDeadline = Date.now() + 60_000;
		let targetIndex = -1;
		for (;;) {
			targetIndex = context.characters.findIndex(
				(character) =>
					typeof character.avatar === "string" &&
					character.avatar.replace(/\.(png|json)$/i, "") === turn.avatar,
			);
			if (targetIndex >= 0) break;
			if (Date.now() >= characterDeadline) {
				throw new Error("角色卡没有出现在沙箱 ST 的列表里");
			}
			await sleep(250);
		}
		const selectDeadline = Date.now() + 30_000;
		for (;;) {
			const state = getContext();
			if (String(state.characterId) !== String(targetIndex) || state.groupId) {
				await context.selectCharacterById(targetIndex);
				await sleep(150);
			}
			const after = getContext();
			if (String(after.characterId) === String(targetIndex) && !after.groupId) {
				break;
			}
			if (Date.now() >= selectDeadline) {
				throw new Error("选中角色卡超时");
			}
		}

		await context.openCharacterChat(turn.chatName);
		if (context.chat.length === 0) {
			throw new Error("聊天片段没有加载出消息");
		}
		await context.generate("normal");
		return {
			preset: turn.preset,
			avatar: turn.avatar,
			messageCount: context.chat.length,
		};
	}, input);
}

async function appendEntry(options: {
	readonly batchDir: string;
	readonly privateRoot: string;
	readonly combination: SandboxCombination;
	readonly status: SandboxRunEntry["status"];
	readonly seqStart: number | null;
	readonly seqEnd: number | null;
	readonly startedAt: string | null;
	readonly finishedAt: string | null;
	readonly reason?: string;
}): Promise<void> {
	const entry: SandboxRunEntry = {
		combinationId: options.combination.combinationId,
		preset: options.combination.preset,
		character: options.combination.character,
		chat: options.combination.chat,
		floor: options.combination.floor,
		seqStart: options.seqStart,
		seqEnd: options.seqEnd,
		startedAt: options.startedAt,
		finishedAt: options.finishedAt,
		status: options.status,
		...(options.reason === undefined ? {} : { reason: options.reason }),
	};
	await appendSandboxRunEntry({
		batchDir: options.batchDir,
		privateRoot: options.privateRoot,
		entry,
	});
}

async function lastRecordSeq(batchDir: string): Promise<number> {
	const records = await readCompleteRecords(batchDir);
	const last = records[records.length - 1];
	return last === undefined ? -1 : last.seq;
}

async function recordsAfter(
	batchDir: string,
	afterSeq: number,
): Promise<readonly PromptRecordSummary[]> {
	const records = await readCompleteRecords(batchDir);
	return records.filter((record) => record.seq > afterSeq);
}

async function waitForRecordsAfter(
	batchDir: string,
	afterSeq: number,
	timeoutMs: number,
): Promise<readonly PromptRecordSummary[]> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const records = await recordsAfter(batchDir, afterSeq);
		if (records.length > 0 || Date.now() >= deadline) return records;
		await sleep(100);
	}
}

/**
 * 录制服务异步追加索引；只接受以换行结尾的完整行，
 * 避免读到正在写入的半行。
 */
async function readCompleteRecords(
	batchDir: string,
): Promise<readonly PromptRecordSummary[]> {
	const text = await readFile(path.join(batchDir, "index.jsonl"), "utf8");
	const end = text.lastIndexOf("\n");
	if (end < 0) return [];
	const records: PromptRecordSummary[] = [];
	for (const line of text.slice(0, end).split("\n")) {
		if (line.trim() === "") continue;
		records.push(JSON.parse(line) as PromptRecordSummary);
	}
	return records;
}

async function withTimeout<T>(
	work: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	const timer = Promise.withResolvers<never>();
	const handle = setTimeout(() => {
		timer.reject(new Error(`${label} 超时（${timeoutMs} 毫秒）`));
	}, timeoutMs);
	work.catch(() => {});
	try {
		return await Promise.race([work, timer.promise]);
	} finally {
		clearTimeout(handle);
	}
}

function describeError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/\s+/g, " ").trim().slice(0, 400);
}

async function sleep(milliseconds: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, milliseconds);
	await promise;
}
