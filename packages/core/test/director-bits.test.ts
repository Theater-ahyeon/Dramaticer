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
