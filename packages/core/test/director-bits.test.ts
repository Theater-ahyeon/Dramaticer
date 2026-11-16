import { describe, expect, it } from "vitest";
import {
	DEFAULT_DIRECTOR_CONFIG,
	type DirectorBit,
	type LlmClient,
	type LlmRequest,
	type LlmResult,
	type StoryStore,
	createDirectorBitJudgmentsHandler,
	createDirectorEngine,
	createDirectorSlotProvider,
	directorBitTextFingerprint,
	parseDirectorBitJudgmentResponse,
} from "../src/index.js";
import { openTempStore } from "./temp-store.js";

const USAGE = {
	promptTokens: 10,
	completionTokens: 20,
	totalTokens: 30,
	reasoningTokens: 0,
	cachedTokens: 0,
};

function llmResult(text: string): LlmResult {
	return {
		text,
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		stopReason: "stop",
		model: "fake-model",
		channel: "fake-channel",
		usage: USAGE,
		raw: null,
		cached: false,
		attempts: 1,
		rounds: 1,
		truncation: null,
		continuation: null,
	};
}

function createFakeClient(replies: readonly string[]): {
	readonly client: LlmClient;
	readonly requests: LlmRequest[];
} {
	const requests: LlmRequest[] = [];
	const client: LlmClient = {
		async complete(request) {
			requests.push(request);
			const reply = replies[requests.length - 1];
			if (reply === undefined) {
				throw new Error("假客户端没有更多回复");
			}
			return llmResult(reply);
		},
	};
	return { client, requests };
}

/** n0 助手、n1 用户、n2 助手、n3 用户、n4 助手。 */
function seedStory(store: StoryStore): string[] {
	store.createStory({ id: "s1", title: "剧情小品" });
	const ids: string[] = [];
	for (let index = 0; index < 5; index += 1) {
		const id = `n${index}`;
		store.appendNode({
			id,
			storyId: "s1",
			parentId: index === 0 ? null : `n${index - 1}`,
			role: index % 2 === 0 ? "assistant" : "user",
			raw: `楼层 ${index}`,
		});
		ids.push(id);
	}
	store.appendStateDiffs([
		{
			storyId: "s1",
			nodeId: "n0",
			path: ["clue", "c1", "status"],
			op: "set",
			value: "open",
			source: "model",
		},
	]);
	return ids;
}

function textBit(
	id: string,
	text: string,
	overrides: Partial<DirectorBit> = {},
): DirectorBit {
	return {
		id,
		condition: { kind: "text", text },
		instruction: `${id} 的指令`,
		priority: 0,
		cooldown: 0,
		after: null,
		repeatable: true,
		fallback: false,
		...overrides,
	};
}

function clueBit(
	id: string,
	overrides: Partial<DirectorBit> = {},
): DirectorBit {
	return {
		id,
		condition: {
			kind: "ledger",
			query: {
				kind: "state",
				path: ["clue", "c1", "status"],
				op: "equals",
				value: "open",
			},
		},
		instruction: `${id} 的指令`,
		priority: 0,
		cooldown: 0,
		after: null,
		repeatable: true,
		fallback: false,
		...overrides,
	};
}

function fallbackBit(
	id: string,
	overrides: Partial<DirectorBit> = {},
): DirectorBit {
	return {
		id,
		condition: null,
		instruction: `${id} 的指令`,
		priority: 0,
		cooldown: 0,
		after: null,
		repeatable: true,
		fallback: true,
		...overrides,
	};
}

function evaluate(
	store: StoryStore,
	nodeId: string,
	config = DEFAULT_DIRECTOR_CONFIG,
) {
	return createDirectorEngine("bits").evaluate({
		store,
		storyId: "s1",
		nodeId,
		config,
	});
}

describe("剧情小品引擎", () => {
	it("台账查询当场判定，文本条件读楼层缓存", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		const bits = [textBit("text", "玩家提到旧伤"), clueBit("clue")];
		store.replaceDirectorBits({ storyId: "s1", bits });
		store.saveDirectorBitJudgments({
			storyId: "s1",
			nodeId: "n0",
			fingerprint: directorBitTextFingerprint(bits),
			judgments: [
				{ id: "text", matched: true, reason: "玩家上一楼提到旧伤" },
				{ id: "clue", matched: false, reason: "台账条件不参与文本判断" },
			],
		});

		const suggestion = evaluate(store, ids[1] as string);
		expect(suggestion).toMatchObject({
			mechanism: "text",
			priority: 0,
			directive: "text 的指令",
		});
		const decision = store.getDirectorDecision(ids[1] as string);
		expect(decision?.mechanisms).toEqual([
			{
				name: "text",
				triggered: true,
				reason: "命中：玩家上一楼提到旧伤",
			},
			{ name: "clue", triggered: false, reason: "优先级低于 text" },
		]);
		expect(decision?.signals).toMatchObject({
			organization: "bits",
			selected: "text",
		});
	});

	it("一次调用判断多个文本条件，结果按楼层缓存后不再调用模型", async () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		const bits = [
			textBit("a", "条件甲"),
			textBit("b", "条件乙", { priority: 2 }),
		];
		store.replaceDirectorBits({ storyId: "s1", bits });
		const { client, requests } = createFakeClient([
			JSON.stringify({
				judgments: [
					{ id: "a", matched: true, reason: "甲成立" },
					{ id: "b", matched: false, reason: "乙不成立" },
				],
			}),
		]);
		const handler = createDirectorBitJudgmentsHandler({ client });
		await handler({
			store,
			client,
			job: {
				id: 1,
				storyId: "s1",
				nodeId: "n0",
				kind: "director_bits",
				status: "running",
				attempts: 1,
				lastError: null,
				createdAt: "2026-11-14T00:00:00.000Z",
				startedAt: null,
				finishedAt: null,
			},
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.messages[1]?.content).toContain('"id":"a"');
		expect(requests[0]?.messages[1]?.content).toContain('"id":"b"');

		const first = evaluate(store, ids[1] as string);
		expect(first?.mechanism).toBe("a");
		expect(requests).toHaveLength(1);
		const second = evaluate(store, ids[3] as string);
		expect(second?.mechanism).toBe("a");
		expect(requests).toHaveLength(1);
		expect(store.findDirectorBitJudgments(ids[3] as string)?.nodeId).toBe("n0");
	});

	it("判断结果缺失时返回 null 并记录缺失原因", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [textBit("text", "玩家提到旧伤")],
		});

		expect(evaluate(store, ids[1] as string)).toBeNull();
		expect(store.getDirectorDecision(ids[1] as string)?.mechanisms).toEqual([
			{
				name: "text",
				triggered: false,
				reason: "自然语言条件的判断结果缺失",
			},
		]);
	});

	it("冷却楼层按当前路径计算", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [clueBit("clue", { cooldown: 2 })],
		});

		expect(evaluate(store, ids[1] as string)?.mechanism).toBe("clue");
		expect(evaluate(store, ids[3] as string)).toBeNull();
		expect(
			store.getDirectorDecision(ids[3] as string)?.mechanisms[0]?.reason,
		).toContain("仍在冷却");
		expect(evaluate(store, ids[4] as string)?.mechanism).toBe("clue");
	});

	it("不可重复的小品只触发一次", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [clueBit("clue", { repeatable: false })],
		});

		expect(evaluate(store, ids[1] as string)?.mechanism).toBe("clue");
		expect(evaluate(store, ids[3] as string)).toBeNull();
		expect(
			store.getDirectorDecision(ids[3] as string)?.mechanisms[0]?.reason,
		).toBe("不可重复且已经在当前路径上触发");
	});

	it("顺序约束要求前一个小品先触发", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [
				clueBit("first", { priority: 1, repeatable: false }),
				clueBit("second", { after: "first" }),
			],
		});

		expect(evaluate(store, ids[1] as string)?.mechanism).toBe("first");
		expect(evaluate(store, ids[3] as string)?.mechanism).toBe("second");
	});

	it("顺序约束未满足时跳过", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [
				clueBit("first", {
					condition: {
						kind: "ledger",
						query: {
							kind: "state",
							path: ["clue", "c1", "text"],
							op: "exists",
						},
					},
				}),
				clueBit("second", { after: "first" }),
			],
		});

		expect(evaluate(store, ids[1] as string)).toBeNull();
		expect(store.getDirectorDecision(ids[1] as string)?.mechanisms).toEqual([
			{ name: "first", triggered: false, reason: "台账条件不成立" },
			{
				name: "second",
				triggered: false,
				reason: "顺序约束未满足：first 尚未触发",
			},
		]);
	});

	it("普通小品命中时不使用兜底，普通小品都不命中时使用兜底", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [clueBit("clue"), fallbackBit("idle", { priority: 10 })],
		});

		expect(evaluate(store, ids[1] as string)?.mechanism).toBe("clue");
		expect(store.getDirectorDecision(ids[1] as string)?.mechanisms[1]).toEqual({
			name: "idle",
			triggered: false,
			reason: "兜底小品：已有普通小品命中",
		});

		const other = openTempStore();
		const otherIds = seedStory(other.store);
		other.store.replaceDirectorBits({
			storyId: "s1",
			bits: [
				clueBit("clue", {
					condition: {
						kind: "ledger",
						query: {
							kind: "state",
							path: ["clue", "c1", "text"],
							op: "exists",
						},
					},
				}),
				fallbackBit("idle"),
			],
		});
		expect(evaluate(other.store, otherIds[1] as string)?.mechanism).toBe(
			"idle",
		);
	});

	it("没有命中时不写建议，决策记录保留每条跳过原因", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [
				clueBit("clue", {
					condition: {
						kind: "ledger",
						query: {
							kind: "state",
							path: ["clue", "c1", "text"],
							op: "exists",
						},
					},
				}),
			],
		});

		expect(evaluate(store, ids[1] as string)).toBeNull();
		const decision = store.getDirectorDecision(ids[1] as string);
		expect(decision?.directive).toBeNull();
		expect(decision?.mechanisms).toEqual([
			{ name: "clue", triggered: false, reason: "台账条件不成立" },
		]);
	});

	it("bits 槽位正常产出建议并在指纹里区分组织方式", async () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({
			storyId: "s1",
			bits: [clueBit("clue")],
		});
		const provider = createDirectorSlotProvider(store, {
			organization: "bits",
			when: "always",
		});
		expect(provider.engine.kind).toBe("bits");
		expect(String(provider.packKey)).toContain('"organization":"bits"');
		const content = await provider.provide({
			slot: "director",
			storyId: "s1",
			nodeId: ids[1] as string,
			switches: {},
			state: undefined,
		});
		expect(content?.source).toBe("director:clue");
		expect(content?.suffix).toContain("【导演】clue 的指令");
	});

	it("导演关闭时不评估也不写决策记录", () => {
		const { store } = openTempStore();
		const ids = seedStory(store);
		store.replaceDirectorBits({ storyId: "s1", bits: [clueBit("clue")] });
		expect(
			evaluate(store, ids[1] as string, {
				...DEFAULT_DIRECTOR_CONFIG,
				mode: "off",
			}),
		).toBeNull();
		expect(store.getDirectorDecision(ids[1] as string)).toBeNull();
	});
});

describe("剧情小品条件判断", () => {
	it("缺少、重复与多余的条件整批拒绝", () => {
		expect(() =>
			parseDirectorBitJudgmentResponse(
				JSON.stringify({
					judgments: [{ id: "a", matched: true, reason: "x" }],
				}),
				["a", "b"],
			),
		).toThrow("条件判断缺少条件 b");
		expect(() =>
			parseDirectorBitJudgmentResponse(
				JSON.stringify({
					judgments: [
						{ id: "a", matched: true, reason: "x" },
						{ id: "a", matched: false, reason: "y" },
					],
				}),
				["a"],
			),
		).toThrow("条件判断.judgments[1].id 重复：a");
		expect(() =>
			parseDirectorBitJudgmentResponse(
				JSON.stringify({
					judgments: [
						{ id: "a", matched: true, reason: "x" },
						{ id: "b", matched: false, reason: "y" },
					],
				}),
				["a"],
			),
		).toThrow("条件判断.judgments[1].id 不在待判断条件里：b");
	});
});
