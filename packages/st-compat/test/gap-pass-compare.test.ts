import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
	LlmCallOptions,
	LlmRequest,
	LlmResult,
	LlmStream,
	LlmStreamingClient,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type { StChatEntry, StChatMessage } from "../src/chat-jsonl.js";
import {
	type SettlementFloorView,
	compareFloors,
	formatCompareReport,
	runGapPassCompareOnEntries,
} from "../src/evalset/gap-pass-compare.js";

const STORY = "compare-test";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "gap-pass-compare-"));
	createdDirs.push(dir);
	return dir;
}

function message(index: number, isUser: boolean, text: string): StChatMessage {
	return {
		index,
		name: isUser ? "玩家" : "凛",
		isUser,
		isSystem: false,
		sendDate: null,
		text,
		swipes: [{ index: 0, text, info: null, variables: null }],
		swipeId: 0,
		reasoning: null,
		variables: null,
		raw: {},
	};
}

function entries(floorCount: number): StChatEntry[] {
	const list: StChatEntry[] = [
		{
			kind: "header",
			header: {
				characterName: "凛",
				userName: "玩家",
				chatMetadata: {},
				raw: {},
			},
		},
	];
	for (let floor = 0; floor < floorCount; floor += 1) {
		list.push({
			kind: "message",
			message: message(floor * 2, true, `第 ${floor + 1} 轮的玩家消息`),
		});
		list.push({
			kind: "message",
			message: message(floor * 2 + 1, false, `第 ${floor + 1} 轮的正文`),
		});
	}
	return list;
}

type SettlementMode = "valid" | "invalid";

function floorIdsInWindow(content: string): string[] {
	const header = /(?:^|\n)结算窗口[：（]/.exec(content);
	if (header === null) return [];
	const start = header.index + (header[0].startsWith("\n") ? 1 : 0);
	const tail = content.slice(start);
	const boundary = tail.indexOf("现场分析用的最近楼层");
	const section = boundary < 0 ? tail : tail.slice(0, boundary);
	return [...section.matchAll(/<楼层 id="([^"]+)"/g)].map(
		(match) => match[1] as string,
	);
}

function settlementProposals(
	ids: readonly string[],
	mode: SettlementMode,
): string {
	const proposals = ids.map((id, index) => ({
		nodeId: id,
		diffs: [
			{
				path:
					mode === "valid"
						? ["character", "凛", "status"]
						: ["未知命名空间", "凛"],
				op: "set",
				value: mode === "valid" ? `第 ${index + 1} 楼的状态` : "坏值",
				confidence: 0.8,
				reason: "测试",
			},
		],
		conflicts: [],
	}));
	return JSON.stringify(proposals);
}

function fakeClient(mode: SettlementMode): LlmStreamingClient {
	const client: LlmStreamingClient = {
		async complete(request: LlmRequest, _options?: LlmCallOptions) {
			const system = request.messages.find((item) => item.role === "system");
			const user = request.messages.find((item) => item.role === "user");
			const systemText =
				typeof system?.content === "string" ? system.content : "";
			const userText = typeof user?.content === "string" ? user.content : "";
			const kind = systemText.includes("替故事引擎完成一次后台记录")
				? "merged"
				: systemText.includes("结算器")
					? "settle"
					: systemText.includes("现场分析师")
						? "scene"
						: systemText.includes("用户意志记录员")
							? "user_will"
							: systemText.includes("修订记录员")
								? "revision"
								: "unknown";
			let text: string;
			if (kind === "settle") {
				text = settlementProposals(floorIdsInWindow(userText), mode);
			} else if (kind === "merged") {
				if (userText.includes("没有待结算的楼层")) {
					text = JSON.stringify({
						scene: "现场分析",
						userWill: [],
						revision: [],
					});
				} else {
					text = JSON.stringify({
						settlement: JSON.parse(
							settlementProposals(floorIdsInWindow(userText), mode),
						),
						scene: "现场分析",
						userWill: [],
						revision: [],
					});
				}
			} else if (kind === "scene") {
				text = "现场分析";
			} else if (kind === "unknown") {
				throw new Error(`测试客户端收到未知提示词：${systemText.slice(0, 20)}`);
			} else {
				text = "[]";
			}
			const result: LlmResult = {
				text,
				reasoning: "",
				toolCalls: [],
				finishReason: "stop",
				stopReason: "stop",
				model: "fake",
				channel: null,
				usage: {
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
				},
				raw: null,
				cached: false,
				attempts: 1,
				rounds: 1,
				truncation: null,
				continuation: null,
			};
			return result;
		},
		stream(): LlmStream {
			throw new Error("测试不支持流式调用");
		},
	};
	return client;
}

describe("runGapPassCompareOnEntries", () => {
	it(
		"两条路径在相同楼层上写入相同事实，请求数与缓存数可读",
		{ timeout: 30_000 },
		async () => {
			const client = fakeClient("valid");
			const report = await runGapPassCompareOnEntries({
				story: STORY,
				floors: 4,
				dir: makeDir(),
				client,
				entries: entries(4),
			});
			expect(report.floors).toBe(4);
			expect(report.independent.settledFloors).toBe(4);
			expect(report.merged.settledFloors).toBe(4);
			expect(report.independent.diffs).toBe(4);
			expect(report.merged.diffs).toBe(4);
			expect(report.independent.invalidEntries).toBe(0);
			expect(report.merged.invalidEntries).toBe(0);
			expect(report.merged.droppedEntries).toBe(0);
			expect(report.agreement.pathAgreement).toBe(1);
			expect(report.agreement.factAgreement).toBe(1);
			expect(report.agreement.floorsIdentical).toBe(4);
			expect(report.independent.failedJobs).toEqual([]);
			expect(report.merged.failedJobs).toEqual([]);
			// 独立任务：1 次结算窗口加 4 楼各 3 个任务；合并调用：每楼一次。
			expect(report.independent.requests).toBe(13);
			expect(report.merged.requests).toBe(4);
			expect(formatCompareReport(report)).toContain("路径一致率 100.0%");
		},
	);

	it(
		"同一个目录重跑时直接复用已完成的样本，不再调用模型",
		{ timeout: 30_000 },
		async () => {
			const dir = makeDir();
			const first = fakeClient("valid");
			const firstReport = await runGapPassCompareOnEntries({
				story: STORY,
				floors: 3,
				dir,
				client: first,
				entries: entries(3),
			});
			let calls = 0;
			const counting: LlmStreamingClient = {
				async complete(request, options) {
					calls += 1;
					return first.complete(request, options);
				},
				stream() {
					throw new Error("测试不支持流式调用");
				},
			};
			const secondReport = await runGapPassCompareOnEntries({
				story: STORY,
				floors: 3,
				dir,
				client: counting,
				entries: entries(3),
			});
			expect(calls).toBe(0);
			expect(secondReport.independent).toEqual(firstReport.independent);
			expect(secondReport.merged).toEqual(firstReport.merged);
			expect(secondReport.agreement).toEqual(firstReport.agreement);
		},
	);

	it(
		"非法路径在两条路径上都记成修复，且整楼不写入",
		{ timeout: 30_000 },
		async () => {
			const report = await runGapPassCompareOnEntries({
				story: STORY,
				floors: 3,
				dir: makeDir(),
				client: fakeClient("invalid"),
				entries: entries(3),
			});
			for (const regime of [report.independent, report.merged]) {
				expect(regime.settledFloors).toBe(3);
				expect(regime.diffs).toBe(0);
				expect(regime.invalidEntries).toBe(3);
			}
			expect(report.agreement.pathUnion).toBe(0);
			expect(report.agreement.pathAgreement).toBeNull();
		},
	);
});

describe("compareFloors", () => {
	it("只有一边有路径时计入 floorsOneSideEmpty", () => {
		const left: SettlementFloorView[] = [
			{
				nodeId: "a",
				settled: true,
				paths: ['["character","凛"]'],
				facts: ["set"],
				repairs: [],
			},
			{ nodeId: "b", settled: true, paths: [], facts: [], repairs: [] },
		];
		const right: SettlementFloorView[] = [
			{ nodeId: "a", settled: true, paths: [], facts: [], repairs: [] },
			{ nodeId: "b", settled: true, paths: [], facts: [], repairs: [] },
		];
		const agreement = compareFloors(left, right);
		expect(agreement.floorsOneSideEmpty).toBe(1);
		expect(agreement.floorsIdentical).toBe(1);
		expect(agreement.pathIntersection).toBe(0);
		expect(agreement.pathUnion).toBe(1);
		expect(agreement.pathAgreement).toBe(0);
	});
});
