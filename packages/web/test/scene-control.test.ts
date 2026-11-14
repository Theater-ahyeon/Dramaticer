import { describe, expect, it } from "vitest";
import { ApiClient } from "../src/api/client";
import {
	SCENE_CONTROL_CHOICES,
	SCENE_PACE_CHOICES,
	describeSceneControlResult,
	isCorrectionReady,
	sceneControlLabel,
	scenePaceLabel,
} from "../src/chat/scene-control";

interface FetchCall {
	readonly url: string;
	readonly init: RequestInit;
}

function clientFor(body: unknown): {
	readonly client: ApiClient;
	readonly calls: FetchCall[];
} {
	const calls: FetchCall[] = [];
	const client = new ApiClient({
		fetch: async (url, init) => {
			calls.push({ url, init });
			return new Response(JSON.stringify(body), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});
		},
	});
	return { client, calls };
}

describe("场面控制与就地纠正的界面选项", () => {
	it("三种操作与三档节奏都有标签", () => {
		expect(SCENE_CONTROL_CHOICES.map((choice) => choice.value)).toEqual([
			"end-scene",
			"jump-time",
			"pace",
		]);
		expect(SCENE_PACE_CHOICES.map((choice) => choice.value)).toEqual([
			"slow",
			"normal",
			"fast",
		]);
		expect(sceneControlLabel("jump-time")).toBe("跳到某个时间");
		expect(scenePaceLabel("fast")).toBe("加快");
		for (const choice of SCENE_CONTROL_CHOICES) {
			expect(choice.hint.length).toBeGreaterThan(0);
		}
	});

	it("纠正要同时有选中的片段与意见", () => {
		expect(isCorrectionReady({ quote: "灯灭了", instruction: "改亮" })).toBe(
			true,
		);
		expect(isCorrectionReady({ quote: "  ", instruction: "改亮" })).toBe(false);
		expect(isCorrectionReady({ quote: "灯灭了", instruction: "\n" })).toBe(
			false,
		);
	});

	it("结果说明写出场次数量与生效的节奏", () => {
		expect(
			describeSceneControlResult({
				control: { kind: "end-scene" },
				scenes: [{ endNodeId: "a2" }, { endNodeId: null }],
				directorConfig: null,
			}),
		).toBe("共 2 场：已结束 1 场，进行中 1 场");
		expect(
			describeSceneControlResult({
				control: { kind: "pace" },
				scenes: [{ endNodeId: null }],
				directorConfig: { pace: 1.6 },
			}),
		).toBe("共 1 场：已结束 0 场，进行中 1 场；节奏快慢 1.6");
	});
});

describe("就地纠正与场面控制的接口调用", () => {
	it("纠正走 /correct 并只发选中片段与意见", async () => {
		const { client, calls } = clientFor({ node: {}, path: {} });
		await client.correctNode("n 1", {
			quote: "灯灭了。",
			instruction: "让灯亮起来",
		});
		const call = calls[0];
		if (call === undefined) throw new Error("缺少请求");
		expect(call.url).toBe("/api/nodes/n%201/correct");
		expect(call.init.method).toBe("POST");
		expect(JSON.parse(String(call.init.body))).toEqual({
			quote: "灯灭了。",
			instruction: "让灯亮起来",
		});
	});

	it("三种场面控制各发自己的载荷", async () => {
		const { client, calls } = clientFor({ control: {}, scenes: [] });
		await client.sceneControl("a1", { kind: "end-scene", note: "收在这里" });
		await client.sceneControl("a1", { kind: "jump-time", time: "三天后" });
		await client.sceneControl("a1", { kind: "pace", pace: "slow" });
		expect(calls.map((call) => call.url)).toEqual([
			"/api/nodes/a1/scene-control",
			"/api/nodes/a1/scene-control",
			"/api/nodes/a1/scene-control",
		]);
		expect(
			calls.map((call) => JSON.parse(String(call.init.body)) as unknown),
		).toEqual([
			{ kind: "end-scene", note: "收在这里" },
			{ kind: "jump-time", time: "三天后" },
			{ kind: "pace", pace: "slow" },
		]);
	});
});
