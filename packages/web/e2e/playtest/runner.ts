import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { LlmClient } from "@dramaticer/core";
import { type Page, expect } from "@playwright/test";
import {
	PLAYTEST_PROGRESS_VERSION,
	type PlaytestProgress,
	assertPlaytestProgressMatches,
	completedRoundCount,
	parsePlaytestProgress,
	rebuildClueFirstSeen,
} from "../../src/playtest/progress";
import type {
	PlaytestOperationRecord,
	PlaytestRecord,
	PlaytestRoundRecord,
	PlaytestRunResult,
} from "../../src/playtest/records";
import { isPlaytestFailureRecord } from "../../src/playtest/records";
import {
	assertNoPrivateIdentifiers,
	collectPrivateIdentifiers,
	renderPrivateReport,
	renderStatsReport,
	scanPrivateIdentifiers,
} from "../../src/playtest/report";
import { summarizePlaytest } from "../../src/playtest/stats";
import { generateSimulatedUserMessage } from "../../src/playtest/user";
import {
	createImportedStory,
	login,
	openStoryTab,
	pathNodeCount,
	totalNodeCount,
} from "../helpers";
import type { PlaytestConfig } from "./config";
import {
	fetchCandidateActions,
	fetchCharacterNames,
	fetchDirector,
	fetchLedgerDiffCount,
	fetchNode,
	fetchOpenClueIds,
	fetchPath,
	fetchTrace,
	fetchTree,
	readPreferenceCounts,
	waitForBackgroundIdle,
} from "./session";

export interface PlaytestDependencies {
	readonly config: PlaytestConfig;
	readonly userClient: LlmClient;
	readonly writerModel: string;
	readonly backgroundModel: string;
}

const TRANSCRIPT_FLOORS = 12;

interface PlaytestLastEdit {
	readonly originalNodeId: string;
	readonly editedNodeId: string;
	readonly originalPreview: string;
	readonly editedPreview: string;
}

export async function runPlaytest(
	page: Page,
	deps: PlaytestDependencies,
): Promise<PlaytestRunResult> {
	const { config } = deps;
	mkdirSync(config.screenshotDir, { recursive: true });
	const sessionStarted = Date.now();
	await login(page, config.password);
	const progress = loadProgress(config);
	const previousRecords = progress === null ? [] : [...progress.records];
	const lastRecord = previousRecords.at(-1);
	if (lastRecord !== undefined && isPlaytestFailureRecord(lastRecord)) {
		console.log(
			`上一次会话在第 ${lastRecord.round} 轮失败（${lastRecord.stepId}），丢弃该失败记录并重试这一轮。`,
		);
		previousRecords.pop();
	}
	const storyId =
		progress?.storyId ?? (await createImportedStory(page, config.storyTitle));
	if (progress !== null) {
		try {
			await fetchTree(page, storyId);
		} catch (error) {
			throw new Error(
				`续跑文件指向的故事 ${storyId} 在数据库中不可读；确认 PLAYTEST_DB 与续跑文件来自同一次运行（${error instanceof Error ? error.message : String(error)}）`,
			);
		}
	}
	const startedAt = progress?.startedAt ?? new Date().toISOString();
	const records: PlaytestRecord[] = previousRecords;
	const characterNames = await fetchCharacterNames(page, storyId);
	await openStoryTab(page, storyId, "chat");
	let openingCandidates: PlaytestRoundRecord["openingCandidates"] = null;
	if (records.length === 0) {
		const openingCount = await waitForCount(
			page,
			".opening-candidate",
			1,
			30_000,
		);
		openingCandidates = {
			count: openingCount,
			visible: openingCount > 0,
			pickedText: null,
		};
	}
	const clueFirstSeen = rebuildClueFirstSeen(
		records,
		await fetchOpenClueIds(page, storyId),
	);
	let lastEdit = await rebuildLastEdit(page, storyId, records);
	let currentStep = "";
	saveProgress(config, storyId, startedAt, records);
	const firstRound = completedRoundCount(records) + 1;
	for (let round = firstRound; round <= config.rounds; round += 1) {
		if (
			config.timeBudgetMs > 0 &&
			Date.now() - sessionStarted >= config.timeBudgetMs
		) {
			console.log(
				`本轮会话达到时间预算，停在 ${completedRoundCount(records)}/${config.rounds} 轮；重跑同一命令会从这一轮继续。`,
			);
			break;
		}
		let screenshot = "";
		try {
			currentStep = `round-${round}/user`;
			const transcript = await buildTranscript(page, storyId);
			const user = await generateSimulatedUserMessage({
				client: deps.userClient,
				model: deps.backgroundModel,
				round,
				transcript,
			});
			const beforeClues = await fetchOpenClueIds(page, storyId);
			currentStep = `round-${round}/send`;
			const beforeCount = await pathNodeCount(page, storyId);
			const composer = page.getByLabel("玩家行动");
			await composer.fill(user);
			await composer.press("Enter");
			await expect
				.poll(
					async () => {
						const count = await pathNodeCount(page, storyId);
						const streaming =
							(await page.locator(".composer-stop").count()) > 0;
						return !streaming && count >= beforeCount + 2;
					},
					{ timeout: config.roundTimeoutMs },
				)
				.toBe(true);
			currentStep = `round-${round}/observe`;
			const path = await fetchPath(page, storyId, { limit: 4 });
			const assistantNode = path.nodes.at(-1);
			const userNode = path.nodes.at(-2);
			if (
				assistantNode === undefined ||
				userNode === undefined ||
				assistantNode.role !== "assistant" ||
				userNode.role !== "user"
			) {
				throw new Error("本轮路径末尾不是预期的用户楼层与助手楼层");
			}
			const background = await waitForBackgroundIdle(
				page,
				storyId,
				config.backgroundWaitMs,
			);
			const trace = await fetchTrace(page, assistantNode.id);
			const [ledgerDiffCount, director, actions, afterClues] =
				await Promise.all([
					fetchLedgerDiffCount(page, assistantNode.id),
					fetchDirector(page, userNode.id),
					fetchCandidateActions(page, assistantNode.id),
					fetchOpenClueIds(page, storyId),
				]);
			const newClueIds = [...afterClues].filter((id) => !beforeClues.has(id));
			const fulfilledClueIds = [...beforeClues].filter(
				(id) => !afterClues.has(id),
			);
			const fulfilledClueAges = fulfilledClueIds.map(
				(id) => round - (clueFirstSeen.get(id) ?? round),
			);
			for (const id of newClueIds) clueFirstSeen.set(id, round);
			const operations: PlaytestOperationRecord[] = [];
			let pickedCandidateText: string | null = null;
			const visibleCandidates = await waitForCount(
				page,
				".candidate-action",
				1,
				Math.min(config.backgroundWaitMs, 30_000),
			);
			screenshot = join(
				config.screenshotDir,
				`round-${String(round).padStart(3, "0")}.png`,
			);
			await page.screenshot({ path: screenshot, fullPage: true });
			if (config.schedule.candidateAt.includes(round)) {
				currentStep = `round-${round}/candidate`;
				if (visibleCandidates > 0) {
					pickedCandidateText = await clickFirstCandidate(page);
					await page.getByLabel("玩家行动").fill("");
				}
			}
			if (config.schedule.optionAt.includes(round)) {
				currentStep = `round-${round}/option`;
				await clickOption(page, storyId, config.dbPath);
				await page.getByLabel("玩家行动").fill("");
			}
			if (config.schedule.swipeAt.includes(round)) {
				currentStep = `round-${round}/swipe`;
				operations.push(
					await swipeLastReply(page, storyId, round, config.dbPath),
				);
			}
			if (config.schedule.editAt.includes(round)) {
				currentStep = `round-${round}/edit`;
				const edit = await editHead(
					page,
					storyId,
					round,
					config.roundTimeoutMs,
				);
				operations.push(edit.operation);
				lastEdit = edit.lastEdit;
			}
			if (config.schedule.branchAt.includes(round)) {
				currentStep = `round-${round}/branch`;
				if (lastEdit === undefined) {
					throw new Error("排期要求分支切换，但此前没有编辑过楼层");
				}
				operations.push(
					await switchBranch(
						page,
						storyId,
						round,
						lastEdit,
						config.roundTimeoutMs,
					),
				);
			}
			const record: PlaytestRoundRecord = {
				kind: "round",
				round,
				userNodeId: userNode.id,
				assistantNodeId: assistantNode.id,
				traceNodeId: trace === null ? null : assistantNode.id,
				user,
				assistant: assistantNode.raw,
				turnMode: trace?.turnMode ?? "fast",
				firstTokenMs: trace?.timing.firstTokenMs ?? null,
				durationMs: trace?.timing.durationMs ?? 0,
				usage: {
					promptTokens: trace?.llm.usage.promptTokens ?? null,
					completionTokens: trace?.llm.usage.completionTokens ?? null,
					totalTokens: trace?.llm.usage.totalTokens ?? null,
					reasoningTokens: trace?.llm.usage.reasoningTokens ?? null,
				},
				ledgerDiffCount,
				newClueIds,
				fulfilledClueIds,
				fulfilledClueAges,
				director,
				candidateActions: {
					count: actions.length,
					visible: visibleCandidates > 0,
					pickedText: pickedCandidateText,
				},
				openingCandidates: round === 1 ? openingCandidates : null,
				operations,
				background: {
					pending: background.pending,
					running: background.running,
					failed: background.failed,
				},
				screenshot,
				createdAt: new Date().toISOString(),
			};
			records.push(record);
			saveProgress(config, storyId, startedAt, records);
			await openStoryTab(page, storyId, "chat");
		} catch (error) {
			const failureScreenshot = join(
				config.screenshotDir,
				`failure-round-${String(round).padStart(3, "0")}.png`,
			);
			await page
				.screenshot({ path: failureScreenshot, fullPage: true })
				.catch(() => undefined);
			records.push({
				kind: "failure",
				round,
				stepId: currentStep === "" ? `round-${round}/unknown` : currentStep,
				error: await describeFailure(page, error),
				screenshot: failureScreenshot,
				createdAt: new Date().toISOString(),
			});
			saveProgress(config, storyId, startedAt, records);
			break;
		}
	}
	const finishedAt = new Date().toISOString();
	const viewport = page.viewportSize();
	const preferenceCounts = readPreferenceCounts(config.dbPath, storyId);
	const result: PlaytestRunResult = {
		meta: {
			rounds: config.rounds,
			viewport:
				viewport === null ? "未设置" : `${viewport.width}×${viewport.height}`,
			writerModel: deps.writerModel,
			backgroundModel: deps.backgroundModel,
			schedule: config.schedule,
			startedAt,
			finishedAt,
		},
		records,
		preferenceCounts,
	};
	const completed = completedRoundCount(records);
	if (completed < config.rounds && !records.some(isPlaytestFailureRecord)) {
		console.log(
			`试玩进度：${completed}/${config.rounds} 轮；本轮未写报告，重跑同一命令会继续。`,
		);
		return result;
	}
	const aggregate = summarizePlaytest({
		requestedRounds: config.rounds,
		records,
		preferenceCounts,
	});
	const context = {
		storyId,
		storyTitle: config.storyTitle,
		characterNames,
		dbPath: config.dbPath,
		channelsPath: config.channelsPath,
	};
	writeReport(
		config.privateReportPath,
		renderPrivateReport({ result, aggregate, context }),
	);
	const identifiers = collectPrivateIdentifiers({ context, records });
	const statsText = renderStatsReport({
		result,
		aggregate,
		scan: scanPrivateIdentifiers("", identifiers),
	});
	const scan = scanPrivateIdentifiers(statsText, identifiers);
	assertNoPrivateIdentifiers(scan);
	writeReport(
		config.statsReportPath,
		renderStatsReport({ result, aggregate, scan }),
	);
	return result;
}

function loadProgress(config: PlaytestConfig): PlaytestProgress | null {
	if (!config.resume || !existsSync(config.progressPath)) return null;
	const progress = parsePlaytestProgress(
		readFileSync(config.progressPath, "utf8"),
	);
	assertPlaytestProgressMatches(progress, {
		storyTitle: config.storyTitle,
		dbPath: config.dbPath,
		channelsPath: config.channelsPath,
		rounds: config.rounds,
		schedule: config.schedule,
	});
	return progress;
}

function saveProgress(
	config: PlaytestConfig,
	storyId: string,
	startedAt: string,
	records: readonly PlaytestRecord[],
): void {
	const progress: PlaytestProgress = {
		version: PLAYTEST_PROGRESS_VERSION,
		storyId,
		storyTitle: config.storyTitle,
		dbPath: config.dbPath,
		channelsPath: config.channelsPath,
		rounds: config.rounds,
		schedule: config.schedule,
		startedAt,
		records,
	};
	mkdirSync(dirname(config.progressPath), { recursive: true });
	const temporary = `${config.progressPath}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
	renameSync(temporary, config.progressPath);
}

/** 续跑时从最近的编辑操作还原两个兄弟楼层，供后续分支切换定位。 */
async function rebuildLastEdit(
	page: Page,
	storyId: string,
	records: readonly PlaytestRecord[],
): Promise<PlaytestLastEdit | undefined> {
	for (
		let recordIndex = records.length - 1;
		recordIndex >= 0;
		recordIndex -= 1
	) {
		const record = records[recordIndex];
		if (record === undefined || record.kind !== "round") continue;
		for (
			let operationIndex = record.operations.length - 1;
			operationIndex >= 0;
			operationIndex -= 1
		) {
			const operation = record.operations[operationIndex];
			if (operation === undefined || operation.kind !== "edit") continue;
			if (operation.text === null) {
				throw new Error(`编辑操作 ${operation.stepId} 缺少正文`);
			}
			const original = await fetchNode(page, storyId, operation.fromNodeId);
			return {
				originalNodeId: operation.fromNodeId,
				editedNodeId: operation.toNodeId,
				originalPreview: previewOf(original.raw),
				editedPreview: previewOf(operation.text),
			};
		}
	}
	return undefined;
}

async function buildTranscript(page: Page, storyId: string): Promise<string> {
	const path = await fetchPath(page, storyId, { limit: TRANSCRIPT_FLOORS });
	if (path.nodes.length === 0) return "（还没有任何对话）";
	return path.nodes
		.map((node) => {
			const label = node.role === "user" ? "你" : "剧情";
			const body = node.raw.replace(/\s+/g, " ").trim().slice(0, 500);
			return `${label}：${body}`;
		})
		.join("\n");
}

async function waitForCount(
	page: Page,
	selector: string,
	min: number,
	timeoutMs: number,
): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const count = await page.locator(selector).count();
		if (count >= min || Date.now() >= deadline) return count;
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 300);
		await promise;
	}
}

async function clickFirstCandidate(page: Page): Promise<string | null> {
	const button = page.locator(".candidate-action").first();
	if ((await button.count()) === 0) return null;
	await button.click();
	const composer = page.getByLabel("玩家行动");
	const value = await composer.inputValue();
	return value.trim().length === 0 ? null : value;
}

async function clickOption(
	page: Page,
	storyId: string,
	dbPath: string,
): Promise<void> {
	const options = page
		.locator(".floor-assistant")
		.last()
		.locator(".block-options button");
	if ((await options.count()) === 0) return;
	const before = readPreferenceCounts(dbPath, storyId).choice;
	await options.first().click();
	await expect
		.poll(() => readPreferenceCounts(dbPath, storyId).choice, {
			timeout: 15_000,
		})
		.toBeGreaterThan(before);
}

async function swipeLastReply(
	page: Page,
	storyId: string,
	round: number,
	dbPath: string,
): Promise<PlaytestOperationRecord> {
	const treeBefore = await fetchTree(page, storyId);
	const fromNodeId = treeBefore.headNodeId;
	if (fromNodeId === null) throw new Error("当前路径没有可重新生成的楼层");
	const before = readPreferenceCounts(dbPath, storyId).swipe;
	await page
		.locator(".floor-assistant")
		.last()
		.getByRole("button", { name: "重新生成" })
		.click();
	await expect
		.poll(() => readPreferenceCounts(dbPath, storyId).swipe, {
			timeout: 180_000,
		})
		.toBe(before + 1);
	const tree = await fetchTree(page, storyId);
	if (tree.headNodeId === null || tree.headNodeId === fromNodeId) {
		throw new Error("重新生成后 head 没有移动");
	}
	const node = await fetchNode(page, storyId, tree.headNodeId);
	return {
		kind: "swipe",
		round,
		stepId: `round-${round}/swipe`,
		fromNodeId,
		toNodeId: node.id,
		text: node.raw,
	};
}

async function editHead(
	page: Page,
	storyId: string,
	round: number,
	timeoutMs: number,
): Promise<{
	readonly operation: PlaytestOperationRecord;
	readonly lastEdit: PlaytestLastEdit;
}> {
	const treeBefore = await fetchTree(page, storyId);
	const originalNodeId = treeBefore.headNodeId;
	if (originalNodeId === null) throw new Error("没有可编辑的楼层");
	const original = await fetchNode(page, storyId, originalNodeId);
	const beforeCount = await totalNodeCount(page, storyId);
	await openStoryTab(page, storyId, "branches");
	await page.locator(".branch-row-head .branch-select").first().click();
	await expect(page.locator(".branch-detail-raw")).toBeVisible({
		timeout: timeoutMs,
	});
	await page.getByRole("button", { name: "编辑正文" }).click();
	const marker = `〔试玩编辑第${round}轮〕`;
	const editedRaw = `${marker}\n${original.raw}`;
	await page.getByLabel("编辑后的正文").fill(editedRaw);
	await page.getByRole("button", { name: "保存编辑" }).click();
	await expect
		.poll(() => totalNodeCount(page, storyId), { timeout: timeoutMs })
		.toBeGreaterThan(beforeCount);
	await expect
		.poll(async () => (await fetchTree(page, storyId)).headNodeId, {
			timeout: timeoutMs,
		})
		.not.toBe(originalNodeId);
	const tree = await fetchTree(page, storyId);
	const editedNodeId = tree.headNodeId;
	if (editedNodeId === null) throw new Error("编辑后没有 head");
	const edited = await fetchNode(page, storyId, editedNodeId);
	return {
		operation: {
			kind: "edit",
			round,
			stepId: `round-${round}/edit`,
			fromNodeId: originalNodeId,
			toNodeId: editedNodeId,
			text: edited.raw,
		},
		lastEdit: {
			originalNodeId,
			editedNodeId,
			originalPreview: previewOf(original.raw),
			editedPreview: previewOf(edited.raw),
		},
	};
}

async function switchBranch(
	page: Page,
	storyId: string,
	round: number,
	lastEdit: PlaytestLastEdit,
	timeoutMs: number,
): Promise<PlaytestOperationRecord> {
	const head = (await fetchTree(page, storyId)).headNodeId;
	const fromNodeId = head ?? lastEdit.editedNodeId;
	const target =
		head === lastEdit.originalNodeId
			? lastEdit.editedNodeId
			: lastEdit.originalNodeId;
	const targetPreview =
		target === lastEdit.originalNodeId
			? lastEdit.originalPreview
			: lastEdit.editedPreview;
	await openStoryTab(page, storyId, "branches");
	const preview = page
		.locator(".branch-preview")
		.filter({ hasText: new RegExp(`^${escapeRegExp(targetPreview)}$`) });
	await expect(preview).toHaveCount(1, { timeout: 15_000 });
	await preview.first().click();
	await page.getByRole("button", { name: "切换到此楼层" }).click();
	await page.getByRole("button", { name: "确认切换" }).click();
	await expect
		.poll(async () => (await fetchTree(page, storyId)).headNodeId, {
			timeout: timeoutMs,
		})
		.toBe(target);
	return {
		kind: "branch",
		round,
		stepId: `round-${round}/branch`,
		fromNodeId,
		toNodeId: target,
		text: null,
	};
}

function previewOf(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, 80);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function describeFailure(page: Page, error: unknown): Promise<string> {
	const notice = await page
		.locator(".error-notice")
		.first()
		.innerText()
		.catch(() => "");
	const message = error instanceof Error ? error.message : String(error);
	return notice.trim().length === 0
		? message
		: `${message}（界面提示：${notice.trim()}）`;
}

function writeReport(filePath: string, text: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, text, "utf8");
}
