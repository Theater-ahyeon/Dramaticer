import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	BLUEPRINT_SUGGESTION_JOB_KIND,
	BLUEPRINT_SUGGESTION_OPERATIONS,
	type BlueprintDiff,
	type BlueprintSuggestionAcceptResult,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	BlueprintSuggestionRejectResult,
	StoryBlueprintSuggestionCreateResult,
	StoryBlueprintSuggestionsView,
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
});
