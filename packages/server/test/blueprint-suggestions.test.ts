import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	BLUEPRINT_SUGGESTION_JOB_KIND,
	BLUEPRINT_SUGGESTION_OPERATIONS,
	type BlueprintDiff,
	type BlueprintMilestone,
	type BlueprintSuggestionAcceptResult,
	type DirectorLine,
	MILESTONE_DEVIATION_OPTIONS,
	milestonePromiseLine,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	BlueprintSuggestionRejectResult,
	StoryBlueprintDeviationView,
	StoryBlueprintEditResult,
	StoryBlueprintSuggestionCreateResult,
	StoryBlueprintSuggestionsView,
	StoryBlueprintVersionsView,
	StoryBlueprintView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-blueprint-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

async function startTestServer(): Promise<RunningServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	mkdirSync(webRoot, { recursive: true });
	writeFileSync(
		join(webRoot, "index.html"),
		"<!doctype html><title>应用</title>",
	);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return running;
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return fetch(`${origin}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

function directorLine(id: string, who: string, want: string): DirectorLine {
	return {
		id,
		kind: "main",
		who,
		want,
		obstacle: "没有被说出口",
		countdown: null,
		preparations: [],
	};
}

function seedStory(running: RunningServer, storyId = "s1"): string {
	running.store.createStory({ id: storyId, title: "蓝图建议测试" });
	const root = running.store.appendNode({
		storyId,
		parentId: null,
		role: "assistant",
		raw: "灯塔下起了雨。",
	});
	const user = running.store.appendNode({
		storyId,
		parentId: root.id,
		role: "user",
		raw: "我走上台阶。",
	});
	const reply = running.store.appendNode({
		storyId,
		parentId: user.id,
		role: "assistant",
		raw: "门缝里透出光。",
	});
	return reply.id;
}

function premiseDiff(): BlueprintDiff {
	return {
		action: "set",
		entry: {
			id: "premise-1",
			kind: "premise",
			source: "ai",
			locked: false,
			coreQuestion: "这座灯塔为谁而亮？",
			tone: "潮湿、克制",
			endings: ["她留下来"],
			redLines: ["她不能出事"],
			tension: "medium",
		},
	};
}

function volumeDiff(): BlueprintDiff {
	return {
		action: "set",
		entry: {
			id: "volume-1",
			kind: "volume",
			source: "ai",
			locked: false,
			title: "第一卷",
			coreQuestion: "谁在守塔？",
			startState: "陌生人到来",
			endState: "身份揭开",
		},
	};
}

function saveSuggestion(
	running: RunningServer,
	storyId: string,
	operation: "complete" | "find-flaws" = "complete",
	diffs: readonly BlueprintDiff[] = [premiseDiff(), volumeDiff()],
): number {
	const request = running.store.createBlueprintSuggestionRequest({
		storyId,
		operation,
	});
	const [suggestion] = running.store.saveBlueprintSuggestions({
		requestId: request.id,
		suggestions: [{ title: "补上总纲与第一卷", reason: "两处还空着", diffs }],
	});
	if (suggestion === undefined) throw new Error("建议没有写入");
	return suggestion.id;
}

describe("蓝图建议接口", () => {
	it("五个操作各自登记请求并推进同一条后台任务", async () => {
		const running = await startTestServer();
		seedStory(running);
		for (const operation of BLUEPRINT_SUGGESTION_OPERATIONS) {
			const response = await post(
				running.origin,
				"/api/stories/s1/blueprint/suggestions",
				{ operation, note: " 想让第二卷更压抑 " },
			);
			expect(response.status).toBe(201);
			const body =
				(await response.json()) as StoryBlueprintSuggestionCreateResult;
			expect(body.request).toMatchObject({
				storyId: "s1",
				operation,
				note: "想让第二卷更压抑",
				status: "pending",
			});
			expect(body.jobId).toBeGreaterThan(0);
		}

		const jobs = running.store.listBackgroundJobs({
			storyId: "s1",
			kinds: [BLUEPRINT_SUGGESTION_JOB_KIND],
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.status).toBe("pending");

		const list = await fetch(
			`${running.origin}/api/stories/s1/blueprint/suggestions`,
		);
		expect(list.status).toBe(200);
		const view = (await list.json()) as StoryBlueprintSuggestionsView;
		expect(view.status).toBe("pending");
		expect(view.suggestions).toEqual([]);
	});

	it("空想法、非法操作与非法状态给出对应错误", async () => {
		const running = await startTestServer();
		seedStory(running);

		const empty = await post(
			running.origin,
			"/api/stories/s1/blueprint/suggestions",
			{},
		);
		expect(empty.status).toBe(400);
		const emptyBody = await errorBody(empty);
		expect(emptyBody.error.code).toBe("bad_request");
		expect(emptyBody.error.details).toMatchObject({ path: "operation" });

		const invalid = await post(
			running.origin,
			"/api/stories/s1/blueprint/suggestions",
			{ operation: "rewrite-everything" },
		);
		expect(invalid.status).toBe(400);
		expect((await errorBody(invalid)).error.details).toMatchObject({
			path: "operation",
		});

		const badNote = await post(
			running.origin,
			"/api/stories/s1/blueprint/suggestions",
			{ operation: "complete", note: 42 },
		);
		expect(badNote.status).toBe(400);
		expect((await errorBody(badNote)).error.details).toMatchObject({
			path: "note",
		});

		const badStatus = await fetch(
			`${running.origin}/api/stories/s1/blueprint/suggestions?status=nope`,
		);
		expect(badStatus.status).toBe(400);
		expect((await errorBody(badStatus)).error.details).toMatchObject({
			path: "status",
		});
	});

	it("建议按状态列出且接受后返回更新后的蓝图", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		const accepted = saveSuggestion(running, "s1");
		const rejected = saveSuggestion(running, "s1", "find-flaws");
		saveSuggestion(running, "s1", "find-flaws");

		const pending = await fetch(
			`${running.origin}/api/stories/s1/blueprint/suggestions?status=pending`,
		);
		const pendingView = (await pending.json()) as StoryBlueprintSuggestionsView;
		expect(pendingView.suggestions.map((item) => item.id)).toEqual([
			accepted,
			rejected,
			accepted + 2,
		]);

		const acceptedResponse = await post(
			running.origin,
			`/api/blueprint-suggestions/${accepted}/accept`,
			{},
		);
		expect(acceptedResponse.status).toBe(200);
		const acceptedBody =
			(await acceptedResponse.json()) as BlueprintSuggestionAcceptResult;
		expect(acceptedBody.suggestion.status).toBe("accepted");
		expect(acceptedBody.record).toMatchObject({
			nodeId: headId,
			source: "player",
		});
		expect(
			acceptedBody.blueprint.map((entry) => `${entry.kind}:${entry.id}`),
		).toEqual(["premise:premise-1", "volume:volume-1"]);
		expect(acceptedBody.blueprint.every((entry) => entry.source === "ai")).toBe(
			true,
		);

		const rejectedResponse = await post(
			running.origin,
			`/api/blueprint-suggestions/${rejected}/reject`,
			{},
		);
		expect(rejectedResponse.status).toBe(200);
		const rejectedBody =
			(await rejectedResponse.json()) as BlueprintSuggestionRejectResult;
		expect(rejectedBody.suggestion.status).toBe("rejected");

		const afterAccept = await fetch(
			`${running.origin}/api/stories/s1/blueprint/suggestions?status=accepted`,
		);
		const afterAcceptView =
			(await afterAccept.json()) as StoryBlueprintSuggestionsView;
		expect(afterAcceptView.suggestions.map((item) => item.id)).toEqual([
			accepted,
		]);

		const again = await post(
			running.origin,
			`/api/blueprint-suggestions/${accepted}/accept`,
			{},
		);
		expect(again.status).toBe(409);
		expect((await errorBody(again)).error.code).toBe("conflict");

		const rejectAccepted = await post(
			running.origin,
			`/api/blueprint-suggestions/${accepted}/reject`,
			{},
		);
		expect(rejectAccepted.status).toBe(409);

		const missing = await post(
			running.origin,
			"/api/blueprint-suggestions/9999/accept",
			{},
		);
		expect(missing.status).toBe(404);
		expect((await errorBody(missing)).error.code).toBe("not_found");

		const notNumber = await post(
			running.origin,
			"/api/blueprint-suggestions/abc/reject",
			{},
		);
		expect(notNumber.status).toBe(404);

		expect(running.store.readBlueprintEntries(headId)).toHaveLength(2);
	});

	it("接受时按当前蓝图重新过滤锁定条目，全部命中时整条拒绝", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		running.store.saveStoryBlueprint({
			nodeId: headId,
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: {
						id: "premise-1",
						kind: "premise",
						source: "player",
						locked: true,
						coreQuestion: "她自己想留下吗？",
						tone: "",
						endings: [],
						redLines: [],
						tension: "medium",
					},
				},
			],
		});
		const suggestionId = saveSuggestion(running, "s1", "complete", [
			{ action: "delete", id: "premise-1" },
		]);

		const response = await post(
			running.origin,
			`/api/blueprint-suggestions/${suggestionId}/accept`,
			{},
		);
		expect(response.status).toBe(409);
		expect((await errorBody(response)).error.code).toBe("conflict");
		expect(running.store.getBlueprintSuggestion(suggestionId)?.status).toBe(
			"pending",
		);
		expect(running.store.readBlueprintEntries(headId)).toHaveLength(1);
	});

	it("接受写到指定楼层，跨故事的楼层被拒绝", async () => {
		const running = await startTestServer();
		seedStory(running, "s1");
		const otherHead = seedStory(running, "s2");
		const suggestionId = saveSuggestion(running, "s1", "complete", [
			premiseDiff(),
		]);

		const crossStory = await post(
			running.origin,
			`/api/blueprint-suggestions/${suggestionId}/accept`,
			{ nodeId: otherHead },
		);
		expect(crossStory.status).toBe(400);
		expect((await errorBody(crossStory)).error.details).toMatchObject({
			path: "nodeId",
		});

		const root = running.store.getPathToNode(
			running.store.getHead("s1")?.id ?? "",
		)[0];
		if (root === undefined) throw new Error("缺少根楼层");
		const response = await post(
			running.origin,
			`/api/blueprint-suggestions/${suggestionId}/accept`,
			{ nodeId: root.id },
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as BlueprintSuggestionAcceptResult;
		expect(body.record).toMatchObject({ nodeId: root.id, source: "player" });
		expect(running.store.getNode(root.id)?.raw).toBe(root.raw);
	});

	it("章末偏离检查返回四态与三个选择，不改写蓝图", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		const milestone: BlueprintMilestone = {
			id: "m1",
			kind: "milestone",
			source: "player",
			locked: false,
			volumeId: "vol1",
			want: "拿到灯塔的钥匙",
			prerequisites: ["找到看门人"],
			after: [],
			hardness: "soft",
		};
		running.store.saveStoryBlueprint({
			nodeId: headId,
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: {
						id: "vol1",
						kind: "volume",
						source: "player",
						locked: false,
						title: "第一卷 灯塔",
						coreQuestion: "谁在塔顶",
						startState: "",
						endState: "",
					},
				},
				{ action: "set", entry: milestone },
			],
		});
		const promise = milestonePromiseLine(milestone, 0);
		const mainOne = directorLine("main-1", "卫宫", "登上塔顶");
		const mainTwo = directorLine("main-2", "海雾", "留住她");
		running.store.saveDirectorLines({
			nodeId: headId,
			storyId: "s1",
			diffs: [
				{ action: "set", line: mainOne },
				{ action: "set", line: mainTwo },
				{ action: "set", line: promise },
			],
		});
		running.store.saveDirectorChapterReview({
			nodeId: headId,
			storyId: "s1",
			payload: {
				promises: [{ lineId: promise.id, disposition: "retire" }],
				focus: [mainOne.id, mainTwo.id],
			},
		});
		const before = running.store.readBlueprintEntries(headId);

		const response = await fetch(
			`${running.origin}/api/stories/s1/blueprint/deviation`,
		);
		expect(response.status).toBe(200);
		const view = (await response.json()) as StoryBlueprintDeviationView;
		expect(view).toEqual({
			storyId: "s1",
			nodeId: headId,
			deviations: [
				{
					milestoneId: "m1",
					state: "lost",
					reason: `铺垫线 ${promise.id} 在章末清点里被作废`,
					options: [...MILESTONE_DEVIATION_OPTIONS],
				},
			],
		});
		expect(running.store.readBlueprintEntries(headId)).toEqual(before);
	});

	it("没有蓝图时偏离列表为空，不存在的故事 404", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		const response = await fetch(
			`${running.origin}/api/stories/s1/blueprint/deviation`,
		);
		expect(response.status).toBe(200);
		expect((await response.json()) as StoryBlueprintDeviationView).toEqual({
			storyId: "s1",
			nodeId: headId,
			deviations: [],
		});

		const missing = await fetch(
			`${running.origin}/api/stories/nope/blueprint/deviation`,
		);
		expect(missing.status).toBe(404);
	});
});

describe("蓝图视图接口", () => {
	function saveBlueprint(running: RunningServer, nodeId: string): void {
		running.store.saveStoryBlueprint({
			nodeId,
			storyId: "s1",
			source: "player",
			diffs: [premiseDiff(), volumeDiff()],
		});
		running.store.saveStoryBlueprint({
			nodeId,
			storyId: "s1",
			source: "player",
			diffs: [
				{
					action: "set",
					entry: {
						id: "milestone-ai",
						kind: "milestone",
						source: "ai",
						locked: false,
						volumeId: "volume-1",
						want: "灯塔的灯被人掐灭",
						prerequisites: ["有人动过灯油"],
						after: [],
						hardness: "soft",
					},
				},
				{
					action: "set",
					entry: {
						id: "milestone-player",
						kind: "milestone",
						source: "player",
						locked: false,
						volumeId: "volume-1",
						want: "玩家写的方向",
						prerequisites: [],
						after: [],
						hardness: "soft",
					},
				},
			],
		});
	}

	it("默认显示全部条目，节点取 head", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		saveBlueprint(running, headId);
		const response = await fetch(`${running.origin}/api/stories/s1/blueprint`);
		expect(response.status).toBe(200);
		const view = (await response.json()) as StoryBlueprintView;
		expect(view.storyId).toBe("s1");
		expect(view.nodeId).toBe(headId);
		expect(view.spoilers).toBe("show");
		expect(view.hidden).toBeNull();
		expect(view.entries.map((entry) => entry.id).sort()).toEqual([
			"milestone-ai",
			"milestone-player",
			"premise-1",
			"volume-1",
		]);
	});

	it("隐藏剧透后只返回玩家条目与按层的条数，不泄露 AI 内容", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		saveBlueprint(running, headId);
		const settings = await fetch(`${running.origin}/api/stories/s1/settings`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ blueprintSpoilers: "hide" }),
		});
		expect(settings.status).toBe(200);

		const response = await fetch(
			`${running.origin}/api/stories/s1/blueprint?nodeId=${headId}`,
		);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain("这座灯塔为谁而亮");
		expect(text).not.toContain("灯塔的灯被人掐灭");
		const view = JSON.parse(text) as StoryBlueprintView;
		expect(view.spoilers).toBe("hide");
		expect(view.entries).toEqual([
			{
				id: "milestone-player",
				kind: "milestone",
				source: "player",
				locked: false,
				volumeId: "volume-1",
				want: "玩家写的方向",
				prerequisites: [],
				after: [],
				hardness: "soft",
			},
		]);
		expect(view.hidden).toEqual({
			premise: 1,
			volume: 1,
			milestone: 1,
			total: 3,
		});
	});

	it("还没有楼层时返回卡导入的默认蓝图", async () => {
		const running = await startTestServer();
		running.store.createStory({ id: "sempty", title: "空的" });
		running.store.saveStoryBlueprintBaseline("sempty", [
			{
				id: "premise",
				kind: "premise",
				source: "player",
				locked: false,
				coreQuestion: "卡里写的问题",
				tone: "冷",
				endings: [],
				redLines: [],
				tension: "medium",
			},
		]);
		const response = await fetch(
			`${running.origin}/api/stories/sempty/blueprint`,
		);
		expect(response.status).toBe(200);
		const view = (await response.json()) as StoryBlueprintView;
		expect(view.nodeId).toBeNull();
		expect(view.entries).toHaveLength(1);
		expect(view.entries[0]?.id).toBe("premise");

		const missing = await fetch(`${running.origin}/api/stories/nope/blueprint`);
		expect(missing.status).toBe(404);
		const empty = await fetch(
			`${running.origin}/api/stories/sempty/blueprint?nodeId=`,
		);
		expect(empty.status).toBe(400);
	});
});

describe("大纲编辑接口", () => {
	it("写一批修改后能读回，修改历史记下变化数", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		const edited = await post(
			running.origin,
			"/api/stories/s1/blueprint/edit",
			{ diffs: [premiseDiff()] },
		);
		expect(edited.status).toBe(200);
		const result = (await edited.json()) as StoryBlueprintEditResult;
		expect(result.nodeId).toBe(headId);
		expect(result.record.source).toBe("player");
		expect(result.entries.map((entry) => entry.id)).toEqual(["premise-1"]);

		const versions = await fetch(
			`${running.origin}/api/stories/s1/blueprint/versions`,
		);
		expect(versions.status).toBe(200);
		const view = (await versions.json()) as StoryBlueprintVersionsView;
		expect(view.nodeId).toBe(headId);
		expect(view.versions).toHaveLength(1);
		expect(view.versions[0]).toMatchObject({
			nodeId: headId,
			seq: 1,
			source: "player",
			changes: 1,
		});
	});

	it("显式给出的 nodeId 写在那一楼，版本历史也按它读", async () => {
		const running = await startTestServer();
		const headId = seedStory(running);
		const root = running.store.getPathToNode(headId)[0];
		if (root === undefined) throw new Error("故事没有根楼层");

		const edited = await post(
			running.origin,
			"/api/stories/s1/blueprint/edit",
			{ nodeId: root.id, diffs: [premiseDiff()] },
		);
		expect(edited.status).toBe(200);
		const result = (await edited.json()) as StoryBlueprintEditResult;
		expect(result.nodeId).toBe(root.id);
		expect(result.entries.map((entry) => entry.id)).toEqual(["premise-1"]);

		const versions = await fetch(
			`${running.origin}/api/stories/s1/blueprint/versions?nodeId=${root.id}`,
		);
		expect(versions.status).toBe(200);
		const view = (await versions.json()) as StoryBlueprintVersionsView;
		expect(view.nodeId).toBe(root.id);
		expect(view.versions).toHaveLength(1);
		expect(view.versions[0]?.nodeId).toBe(root.id);
	});

	it("回到某一版会成为新的一批修改", async () => {
		const running = await startTestServer();
		seedStory(running);
		await post(running.origin, "/api/stories/s1/blueprint/edit", {
			diffs: [premiseDiff()],
		});
		const first = await fetch(`${running.origin}/api/stories/s1/blueprint`);
		const firstView = (await first.json()) as StoryBlueprintView;
		const changed: BlueprintDiff = {
			action: "set",
			entry: {
				id: "premise-1",
				kind: "premise",
				source: "ai",
				locked: false,
				coreQuestion: "这座灯塔为谁而亮？",
				tone: "潮湿、克制",
				endings: ["她留下来"],
				redLines: ["她不能出事"],
				tension: "tight",
			},
		};
		await post(running.origin, "/api/stories/s1/blueprint/edit", {
			diffs: [changed],
		});
		const second = await fetch(`${running.origin}/api/stories/s1/blueprint`);
		const secondView = (await second.json()) as StoryBlueprintView;
		expect(secondView.entries[0]).toMatchObject({ tension: "tight" });

		const rolled = await post(
			running.origin,
			"/api/stories/s1/blueprint/edit",
			{ versionNodeId: firstView.nodeId, versionSeq: 1 },
		);
		expect(rolled.status).toBe(200);
		const current = await fetch(`${running.origin}/api/stories/s1/blueprint`);
		const currentView = (await current.json()) as StoryBlueprintView;
		expect(currentView.entries[0]).toMatchObject({
			id: "premise-1",
			tension: "medium",
		});
	});

	it("diffs 与 versionNodeId 必须给出其中一个", async () => {
		const running = await startTestServer();
		seedStory(running);
		const response = await post(
			running.origin,
			"/api/stories/s1/blueprint/edit",
			{},
		);
		expect(response.status).toBe(400);
	});
});
