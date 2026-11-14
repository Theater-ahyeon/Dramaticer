import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_KIND_JOB_KIND, createTokenEstimator } from "@dramaticer/core";
import type {
	ApiErrorResponse,
	ImportAuditEntryKindUpdateResult,
	ImportAuditEntryMemoryUpdateResult,
	ImportAuditMemoryConvertResult,
	ImportAuditReportView,
	ImportAuditSuggestionResult,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-import-audit-"));
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

function request(
	origin: string,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${origin}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
}

function post(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "POST", body: JSON.stringify(body) });
}

function patch(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "PATCH", body: JSON.stringify(body) });
}

function put(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "PUT", body: JSON.stringify(body) });
}

async function errorBody(response: Response): Promise<ApiErrorResponse> {
	return (await response.json()) as ApiErrorResponse;
}

const cardData = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "云裳",
		description: "青云宗剑修",
		first_mes: "山门外的风很冷。",
		character_book: {
			name: "云裳的世界",
			entries: [
				{
					id: 1,
					keys: ["剑冢"],
					comment: "剑冢",
					content: "山后埋着历代断剑。",
					enabled: true,
					constant: true,
				},
				{
					id: 2,
					keys: [],
					comment: "",
					content: "那一年的冬天格外漫长。\n人们把粮食藏进地窖。",
					enabled: true,
				},
			],
		},
	},
};

interface Seeded {
	readonly running: RunningServer;
	readonly report: ImportAuditReportView;
}

async function seed(): Promise<Seeded> {
	const running = await startTestServer();
	const created = await post(running.origin, "/api/stories", {
		id: "s1",
		title: "山门",
	});
	expect(created.status).toBe(201);
	const imported = await post(running.origin, "/api/stories/s1/import", {
		card: { format: "json", data: JSON.stringify(cardData) },
	});
	expect(imported.status).toBe(200);
	const response = await request(
		running.origin,
		"/api/stories/s1/import-audit",
	);
	expect(response.status).toBe(200);
	return { running, report: (await response.json()) as ImportAuditReportView };
}

describe("导入体检接口", () => {
	it("按分型结果返回条数、未识别清单与常驻 token 前后", async () => {
		const { report } = await seed();

		expect(report.importMode).toBe("upgrade");
		expect(report.total).toBe(2);
		const byKind = new Map(report.counts.map((row) => [row.kind, row.count]));
		expect(byKind.get("common")).toBe(1);
		expect(byKind.get("unknown")).toBe(1);
		expect(byKind.size).toBe(11);
		expect(report.entries).toHaveLength(2);
		expect(report.unknown).toHaveLength(1);
		const unknown = report.unknown[0];
		if (unknown === undefined) throw new Error("没有未识别条目");
		expect(unknown.title).toBe("");
		expect(unknown.rulePrimary).toBe("unknown");
		expect(unknown.content).toContain("人们把粮食藏进地窖。");
		expect(report.authorOptions).toEqual([]);
		expect(report.pluginResidue).toEqual([]);

		const estimator = createTokenEstimator();
		expect(report.tokens.beforeEntries).toBe(1);
		expect(report.tokens.before).toBe(
			estimator(
				["世界书条目：", "【常驻】剑冢：山后埋着历代断剑。"].join("\n"),
			),
		);
		expect(report.tokens.afterEntries).toBe(1);
		expect(report.tokens.after).toBe(
			estimator(["世界书条目：", "剑冢：山后埋着历代断剑。"].join("\n")),
		);
	});

	it("玩家改类型后重算，来源与规则判定分开保存，可以回到规则判定", async () => {
		const { running, report } = await seed();
		const unknown = report.unknown[0];
		if (unknown === undefined) throw new Error("没有未识别条目");
		const path = `/api/stories/s1/import-audit/entries/${encodeURIComponent(
			unknown.source,
		)}`;

		const adjusted = await patch(running.origin, path, { kind: "event" });
		expect(adjusted.status).toBe(200);
		const adjustedBody =
			(await adjusted.json()) as ImportAuditEntryKindUpdateResult;
		expect(adjustedBody.entry).toMatchObject({
			kind: "event",
			kindSource: "player",
			rulePrimary: "unknown",
		});
		expect(adjustedBody.report.unknown).toEqual([]);
		expect(
			adjustedBody.report.counts.find((row) => row.kind === "event")?.count,
		).toBe(1);

		const mismatched = await patch(running.origin, path, {
			kind: "entity",
			kindSource: "rule",
		});
		expect(mismatched.status).toBe(400);
		expect((await errorBody(mismatched)).error.details).toEqual({
			path: "kind",
		});

		const restored = await patch(running.origin, path, {
			kind: "unknown",
			kindSource: "rule",
		});
		expect(restored.status).toBe(200);
		const restoredBody =
			(await restored.json()) as ImportAuditEntryKindUpdateResult;
		expect(restoredBody.entry).toMatchObject({
			kind: "unknown",
			kindSource: "rule",
		});
		expect(restoredBody.report.unknown).toHaveLength(1);
	});

	it("非法类型、非法来源与不存在的条目各自报错", async () => {
		const { running, report } = await seed();
		const unknown = report.unknown[0];
		if (unknown === undefined) throw new Error("没有未识别条目");
		const path = `/api/stories/s1/import-audit/entries/${encodeURIComponent(
			unknown.source,
		)}`;

		const badKind = await patch(running.origin, path, { kind: "nonsense" });
		expect(badKind.status).toBe(400);
		expect((await errorBody(badKind)).error.details).toEqual({ path: "kind" });

		const badSource = await patch(running.origin, path, {
			kind: "event",
			kindSource: "model",
		});
		expect(badSource.status).toBe(400);
		expect((await errorBody(badSource)).error.details).toEqual({
			path: "kindSource",
		});

		const missing = await patch(
			running.origin,
			"/api/stories/s1/import-audit/entries/nope",
			{ kind: "event" },
		);
		expect(missing.status).toBe(404);
	});

	it("有未识别条目时入队一次后台建议，重复调用复用同一条任务", async () => {
		const { running } = await seed();

		const first = await post(
			running.origin,
			"/api/stories/s1/import-audit/suggestions",
			{},
		);
		expect(first.status).toBe(202);
		const firstBody = (await first.json()) as ImportAuditSuggestionResult;
		expect(firstBody).toMatchObject({
			storyId: "s1",
			kind: IMPORT_KIND_JOB_KIND,
		});
		const jobs = running.store.listBackgroundJobs({
			storyId: "s1",
			kinds: [IMPORT_KIND_JOB_KIND],
		});
		expect(jobs).toHaveLength(1);
		expect(jobs[0]?.nodeId).toBeNull();
		expect(jobs[0]?.status).toBe("pending");

		const second = await post(
			running.origin,
			"/api/stories/s1/import-audit/suggestions",
			{},
		);
		expect(second.status).toBe(202);
		expect(((await second.json()) as ImportAuditSuggestionResult).jobId).toBe(
			firstBody.jobId,
		);
	});

	it("没有等待建议的未识别条目时返回 409", async () => {
		const { running, report } = await seed();
		const unknown = report.unknown[0];
		if (unknown === undefined) throw new Error("没有未识别条目");
		const adjusted = await patch(
			running.origin,
			`/api/stories/s1/import-audit/entries/${encodeURIComponent(unknown.source)}`,
			{ kind: "writing" },
		);
		expect(adjusted.status).toBe(200);

		const response = await post(
			running.origin,
			"/api/stories/s1/import-audit/suggestions",
			{},
		);
		expect(response.status).toBe(409);
		expect((await errorBody(response)).error.code).toBe("conflict");
	});

	it("切换导入模式，插件残留一键转成初始记忆并可撤销", async () => {
		const running = await startTestServer();
		const created = await post(running.origin, "/api/stories", {
			id: "s2",
			title: "列岛",
		});
		expect(created.status).toBe(201);
		const imported = await post(running.origin, "/api/stories/s2/import", {
			card: {
				format: "json",
				data: JSON.stringify({
					spec: "chara_card_v2",
					spec_version: "2.0",
					data: {
						name: "列岛",
						description: "潮汐之国",
						first_mes: "潮水退了。",
						character_book: {
							name: "列岛",
							entries: [
								{
									id: 1,
									keys: [],
									comment: "世界观",
									content: "这是一个被潮汐分开的列岛世界。",
									enabled: true,
									constant: true,
								},
								{
									id: 2,
									keys: ["回顾"],
									comment: "总结",
									content: "前情提要：潮水退了，灯塔亮着。",
									enabled: true,
									constant: true,
								},
							],
						},
					},
				}),
			},
		});
		expect(imported.status).toBe(200);

		const initial = (await (
			await request(running.origin, "/api/stories/s2/import-audit")
		).json()) as ImportAuditReportView;
		expect(initial.importMode).toBe("upgrade");
		expect(initial.pluginResidue).toHaveLength(1);
		expect(initial.tokens.beforeEntries).toBe(2);

		const settings = await put(running.origin, "/api/stories/s2/settings", {
			importMode: "raw",
		});
		expect(settings.status).toBe(200);
		const raw = (await (
			await request(running.origin, "/api/stories/s2/import-audit")
		).json()) as ImportAuditReportView;
		expect(raw.importMode).toBe("raw");

		const residue = raw.pluginResidue[0];
		if (residue === undefined) throw new Error("没有插件残留条目");
		const converted = await post(
			running.origin,
			"/api/stories/s2/import-audit/memory",
			{},
		);
		expect(converted.status).toBe(200);
		const convertedBody =
			(await converted.json()) as ImportAuditMemoryConvertResult;
		expect(convertedBody.converted).toBe(1);
		expect(convertedBody.report.pluginResidue[0]).toMatchObject({
			memory: true,
		});
		expect(convertedBody.report.tokens.beforeEntries).toBe(1);
		expect(
			convertedBody.report.entries.find(
				(entry) => entry.source === residue.source,
			),
		).toMatchObject({ memory: true });

		const entryPath = `/api/stories/s2/import-audit/entries/${encodeURIComponent(
			residue.source,
		)}`;
		const restored = await put(running.origin, `${entryPath}/memory`, {
			memory: false,
		});
		expect(restored.status).toBe(200);
		const restoredBody =
			(await restored.json()) as ImportAuditEntryMemoryUpdateResult;
		expect(restoredBody.entry).toMatchObject({ memory: false });
		expect(restoredBody.report.tokens.beforeEntries).toBe(2);

		const common = initial.entries.find((entry) => entry.kind === "common");
		if (common === undefined) throw new Error("没有常识条目");
		const rejected = await put(
			running.origin,
			`/api/stories/s2/import-audit/entries/${encodeURIComponent(common.source)}/memory`,
			{ memory: true },
		);
		expect(rejected.status).toBe(400);
		expect((await errorBody(rejected)).error.details).toEqual({
			path: "memory",
		});

		const badBody = await put(running.origin, `${entryPath}/memory`, {
			memory: "yes",
		});
		expect(badBody.status).toBe(400);
		expect((await errorBody(badBody)).error.details).toEqual({
			path: "memory",
		});

		const missing = await put(
			running.origin,
			"/api/stories/s2/import-audit/entries/nope/memory",
			{ memory: true },
		);
		expect(missing.status).toBe(404);
	});

	it("故事不存在时接口 404", async () => {
		const running = await startTestServer();
		const report = await request(
			running.origin,
			"/api/stories/missing/import-audit",
		);
		expect(report.status).toBe(404);
		const suggestions = await post(
			running.origin,
			"/api/stories/missing/import-audit/suggestions",
			{},
		);
		expect(suggestions.status).toBe(404);
	});
});
