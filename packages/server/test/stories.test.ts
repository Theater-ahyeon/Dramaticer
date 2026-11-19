import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
	DEFAULT_DIRECTOR_CONFIG,
	VISUAL_PROFILE_JOB_KIND,
	readLoreCopy,
} from "@dramaticer/core";
import type {
	ApiErrorResponse,
	ImportStoryResult,
	StoryFeatureView,
	StorySettings,
	StoryView,
} from "@dramaticer/protocol";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-server-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
}

async function startTestServer(): Promise<TestServer> {
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
	return { running, dir };
}

async function request(
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

function put(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "PUT", body: JSON.stringify(body) });
}

function patch(origin: string, path: string, body: unknown): Promise<Response> {
	return request(origin, path, { method: "PATCH", body: JSON.stringify(body) });
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
		nickname: "阿裳",
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
				},
			],
		},
		extensions: {
			dramaticer: {
				events: [{ id: "bridge", text: "山洪冲垮石桥", cooldown: 4 }],
				npcAgendas: [
					{
						npc: "阿裳",
						goal: "寻找剑冢",
						everyChapters: 2,
						importance: 0.8,
					},
				],
			},
		},
	},
};

const worldJson = JSON.stringify({
	entries: {
		"0": {
			key: ["雾谷"],
			comment: "雾谷",
			content: "终年大雾，少有人进出。",
			disable: false,
		},
	},
});

function pngChunk(name: string, data: Uint8Array): Buffer {
	const type = Buffer.from(name, "ascii");
	const body = Buffer.from(data);
	const out = Buffer.alloc(12 + body.length);
	out.writeUInt32BE(body.length, 0);
	type.copy(out, 4);
	body.copy(out, 8);
	out.writeUInt32BE(crc32(Buffer.concat([type, body])) >>> 0, 8 + body.length);
	return out;
}

function buildPngCard(card: unknown): string {
	const signature = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0);
	ihdr.writeUInt32BE(1, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const text = Buffer.concat([
		Buffer.from("chara", "latin1"),
		Buffer.from([0]),
		Buffer.from(
			Buffer.from(JSON.stringify(card), "utf8").toString("base64"),
			"latin1",
		),
	]);
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
		pngChunk("tEXt", text),
		pngChunk("IEND", new Uint8Array(0)),
	]).toString("base64");
}

const validTemplate = {
	id: "custom-template",
	segments: [{ id: "intro", kind: "static", text: "从这里开始。" }],
};

describe("故事接口", () => {
	it("创建、列出、读取与重命名故事", async () => {
		const { running } = await startTestServer();
		const created = await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		expect(created.status).toBe(201);
		const story = (await created.json()) as StoryView;
		expect(story).toMatchObject({
			id: "story-1",
			title: "山门",
			headNodeId: null,
		});
		expect(typeof story.createdAt).toBe("string");

		const listResponse = await request(running.origin, "/api/stories");
		expect(listResponse.status).toBe(200);
		const list = (await listResponse.json()) as StoryView[];
		expect(list.map((item) => item.id)).toEqual(["story-1"]);

		const detail = await request(running.origin, "/api/stories/story-1");
		expect(detail.status).toBe(200);
		expect(((await detail.json()) as StoryView).title).toBe("山门");

		const renamed = await patch(running.origin, "/api/stories/story-1", {
			title: "青云山门",
		});
		expect(renamed.status).toBe(200);
		expect(((await renamed.json()) as StoryView).title).toBe("青云山门");
		expect(running.store.getStory("story-1")?.title).toBe("青云山门");
	});

	it("缺失故事 404，空标题与重复 id 返回带字段路径的 400 与 409", async () => {
		const { running } = await startTestServer();
		const missing = await request(running.origin, "/api/stories/none");
		expect(missing.status).toBe(404);
		expect((await errorBody(missing)).error.code).toBe("not_found");

		const empty = await post(running.origin, "/api/stories", { title: "   " });
		expect(empty.status).toBe(400);
		expect((await errorBody(empty)).error.details).toEqual({ path: "title" });

		await post(running.origin, "/api/stories", { id: "dup", title: "第一个" });
		const duplicate = await post(running.origin, "/api/stories", {
			id: "dup",
			title: "第二个",
		});
		expect(duplicate.status).toBe(409);
		expect((await errorBody(duplicate)).error.details).toEqual({ path: "id" });
	});
});

describe("导入接口", () => {
	it("JSON 卡与外部世界书写入实体、lore、原生扩展与设置，重复导入只补缺失内容", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});

		const first = await post(running.origin, "/api/stories/story-1/import", {
			card: { format: "json", data: JSON.stringify(cardData) },
			worlds: [worldJson],
		});
		expect(first.status).toBe(200);
		const imported = (await first.json()) as ImportStoryResult;
		expect(imported.cardName).toBe("云裳");
		expect(imported.settings.cardName).toBe("云裳");
		expect(imported.settings.characterPrompt).toContain("云裳");
		expect(imported.imported).toEqual({
			entities: { created: 3, merged: 0, aliases: 1, skipped: 0 },
			lore: { inserted: 2, existing: 0, skipped: 0 },
			events: { inserted: 1, updated: 0 },
			npcAgendas: { inserted: 1, updated: 0 },
			bits: { replaced: 0 },
			rules: { replaced: 0 },
			dependencies: { satisfied: true, issues: [] },
		});
		expect(running.store.listEntities("story-1")).toHaveLength(3);
		expect(running.store.listLoreEntries("story-1")).toHaveLength(2);
		expect(running.store.listEventPool("story-1")).toHaveLength(1);
		expect(running.store.listNpcAgendas("story-1")).toHaveLength(1);
		const profileJobs = running.store.listBackgroundJobs({
			storyId: "story-1",
			kinds: [VISUAL_PROFILE_JOB_KIND],
		});
		expect(profileJobs).toHaveLength(1);
		expect(profileJobs[0]?.nodeId).toBeNull();
		expect(profileJobs[0]?.status).toBe("pending");

		const second = await post(running.origin, "/api/stories/story-1/import", {
			card: { format: "json", data: JSON.stringify(cardData) },
			worlds: [worldJson],
		});
		expect(second.status).toBe(200);
		const again = (await second.json()) as ImportStoryResult;
		expect(again.imported.entities).toEqual({
			created: 0,
			merged: 3,
			aliases: 0,
			skipped: 0,
		});
		expect(again.imported.lore).toEqual({
			inserted: 0,
			existing: 2,
			skipped: 0,
		});
		expect(again.imported.events).toEqual({ inserted: 0, updated: 1 });
		expect(running.store.listEntities("story-1")).toHaveLength(3);
		expect(running.store.listLoreEntries("story-1")).toHaveLength(2);
	});

	it("PNG 卡使用 base64 上传", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		const response = await post(running.origin, "/api/stories/story-1/import", {
			card: { format: "png", data: buildPngCard(cardData) },
		});
		expect(response.status).toBe(200);
		const imported = (await response.json()) as ImportStoryResult;
		expect(imported.cardName).toBe("云裳");
		expect(imported.imported.entities.created).toBe(2);
		expect(imported.imported.lore.inserted).toBe(1);
	});

	it("非法卡片、非法世界书与未知故事都返回 400 与 404", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});

		const badCard = await post(running.origin, "/api/stories/story-1/import", {
			card: { format: "json", data: "不是 JSON" },
		});
		expect(badCard.status).toBe(400);
		expect((await errorBody(badCard)).error.details).toEqual({ path: "card" });

		const badBase64 = await post(
			running.origin,
			"/api/stories/story-1/import",
			{ card: { format: "png", data: "not base64!" } },
		);
		expect(badBase64.status).toBe(400);
		expect((await errorBody(badBase64)).error.details).toEqual({
			path: "card.data",
		});

		const badWorld = await post(running.origin, "/api/stories/story-1/import", {
			card: { format: "json", data: JSON.stringify(cardData) },
			worlds: ["{}"],
		});
		expect(badWorld.status).toBe(400);
		expect((await errorBody(badWorld)).error.details).toEqual({
			path: "worlds[0]",
		});

		const missing = await post(running.origin, "/api/stories/none/import", {
			card: { format: "json", data: JSON.stringify(cardData) },
		});
		expect(missing.status).toBe(404);
	});
});

describe("卡的推荐与固定版本", () => {
	function cardWith(entries: readonly unknown[], config?: unknown): unknown {
		return {
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "云裳",
				description: "青云宗剑修",
				first_mes: "山门外的风很冷。",
				character_book: { name: "云裳的世界", entries },
				extensions: {
					dramaticer: config === undefined ? {} : { config },
				},
			},
		};
	}

	it("载入卡时记下推荐配置，一键回到推荐会清掉写作上的调整", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		const imported = await post(running.origin, "/api/stories/story-1/import", {
			card: {
				format: "json",
				data: JSON.stringify(
					cardWith(
						[
							{
								id: 1,
								keys: ["剑冢"],
								comment: "剑冢",
								content: "山后埋着历代断剑。",
								enabled: true,
							},
						],
						{
							writing: { length: "long", person: "third" },
							turnMode: "plan",
							features: {
								tier: "immersive",
								switches: { search: true },
							},
						},
					),
				),
			},
		});
		expect(imported.status).toBe(200);

		const writing = (await (
			await request(running.origin, "/api/stories/story-1/writing")
		).json()) as {
			dials: Record<string, unknown>;
			recommended: Record<string, unknown> | null;
			overrides: Record<string, unknown>;
		};
		expect(writing.dials).toMatchObject({ length: "long", person: "third" });
		expect(writing.recommended).toMatchObject({ length: "long" });
		const cardView = (await (
			await request(running.origin, "/api/stories/story-1/card")
		).json()) as {
			card: { name: string; version: string } | null;
			recommendedMode: string | null;
		};
		expect(cardView.card?.name).toBe("云裳");
		expect(cardView.card?.version).toMatch(/^[0-9a-f]{16}$/);
		expect(cardView.recommendedMode).toBe("plan");
		// 卡推荐的写法只是展示值；导入不替玩家切换回合模式。
		const importedSettings = (await (
			await request(running.origin, "/api/stories/story-1/settings")
		).json()) as { turnMode: string };
		expect(importedSettings.turnMode).toBe("fast");

		const features = (await (
			await request(running.origin, "/api/stories/story-1/features")
		).json()) as {
			tier: string;
			groups: { switches: { id: string; value: unknown }[] }[];
		};
		expect(features.tier).toBe("immersive");
		expect(
			features.groups
				.flatMap((group) => group.switches)
				.find((item) => item.id === "search")?.value,
		).toBe(true);

		await put(running.origin, "/api/stories/story-1/writing", {
			length: "short",
		});
		await put(running.origin, "/api/stories/story-1/settings", {
			turnMode: "deep",
			featureTier: "lite",
			featureSwitches: { search: false },
		});

		const reset = await request(
			running.origin,
			"/api/stories/story-1/writing",
			{ method: "DELETE" },
		);
		expect(reset.status).toBe(200);
		const restored = (await reset.json()) as {
			dials: Record<string, unknown>;
			overrides: Record<string, unknown>;
		};
		expect(restored.dials.length).toBe("long");
		expect(restored.overrides).toEqual({});

		const resetFeatures = (await (
			await request(running.origin, "/api/stories/story-1/features")
		).json()) as {
			tier: string;
			groups: { switches: { id: string; value: unknown }[] }[];
		};
		expect(resetFeatures.tier).toBe("immersive");
		expect(
			resetFeatures.groups
				.flatMap((group) => group.switches)
				.find((item) => item.id === "search")?.value,
		).toBe(true);
		const settings = (await (
			await request(running.origin, "/api/stories/story-1/settings")
		).json()) as { turnMode: string };
		expect(settings.turnMode).toBe("deep");
	});

	it("升级差异也看名称、关键词与常驻", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		const entry = {
			id: 1,
			keys: ["剑冢"],
			comment: "剑冢",
			content: "山后埋着历代断剑。",
			enabled: true,
		};
		await post(running.origin, "/api/stories/story-1/import", {
			card: {
				format: "json",
				data: JSON.stringify(cardWith([entry])),
			},
		});

		const keywords = cardWith([{ ...entry, keys: ["剑冢", "断剑"] }]);
		const keywordsDiff = await post(
			running.origin,
			"/api/stories/story-1/card/diff",
			{ card: { format: "json", data: JSON.stringify(keywords) }, apply: true },
		);
		expect(await keywordsDiff.json()).toMatchObject({
			changed: ["剑冢"],
			added: [],
			removed: [],
		});
		expect(readLoreCopy(running.store, "story-1")[0]?.entry.keywords).toEqual([
			"剑冢",
			"断剑",
		]);

		const constant = cardWith([
			{ ...entry, keys: ["剑冢", "断剑"], constant: true },
		]);
		const constantDiff = await post(
			running.origin,
			"/api/stories/story-1/card/diff",
			{ card: { format: "json", data: JSON.stringify(constant) }, apply: true },
		);
		expect(await constantDiff.json()).toMatchObject({ changed: ["剑冢"] });
		expect(readLoreCopy(running.store, "story-1")[0]?.entry.constant).toBe(
			true,
		);

		const renamed = cardWith([
			{
				...entry,
				comment: "旧剑冢",
				keys: ["剑冢", "断剑"],
				constant: true,
			},
		]);
		const renamedDiff = await post(
			running.origin,
			"/api/stories/story-1/card/diff",
			{ card: { format: "json", data: JSON.stringify(renamed) }, apply: true },
		);
		expect(await renamedDiff.json()).toMatchObject({ changed: ["剑冢"] });
		expect(readLoreCopy(running.store, "story-1")[0]?.entry.name).toBe(
			"旧剑冢",
		);
	});

	it("卡库里的新版不自动进入故事，玩家选择升级后才更新", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		const v1 = cardWith([
			{
				id: 1,
				keys: ["剑冢"],
				comment: "剑冢",
				content: "山后埋着历代断剑。",
				enabled: true,
			},
		]);
		await post(running.origin, "/api/stories/story-1/import", {
			card: { format: "json", data: JSON.stringify(v1) },
		});
		const before = (await (
			await request(running.origin, "/api/stories/story-1/card")
		).json()) as { card: { version: string } };
		const v2 = cardWith([
			{
				id: 1,
				keys: ["剑冢"],
				comment: "剑冢",
				content: "山后埋着历代断剑，夜里会响。",
				enabled: true,
			},
			{
				id: 2,
				keys: ["新碑"],
				comment: "新碑",
				content: "山门旁立了一块新碑。",
				enabled: true,
			},
		]);
		const payload = { format: "json", data: JSON.stringify(v2) };

		const diffResponse = await post(
			running.origin,
			"/api/stories/story-1/card/diff",
			{ card: payload },
		);
		expect(diffResponse.status).toBe(200);
		expect(await diffResponse.json()).toEqual({
			storyId: "story-1",
			same: false,
			added: ["新碑"],
			changed: ["剑冢"],
			removed: [],
		});
		const afterDiff = (await (
			await request(running.origin, "/api/stories/story-1/card")
		).json()) as { card: { version: string } };
		expect(afterDiff.card.version).toBe(before.card.version);
		expect(
			readLoreCopy(running.store, "story-1").map((item) => item.entry.content),
		).toEqual(["山后埋着历代断剑。"]);

		const upgrade = await post(
			running.origin,
			"/api/stories/story-1/card/diff",
			{ card: payload, apply: true },
		);
		expect(upgrade.status).toBe(200);
		expect(
			readLoreCopy(running.store, "story-1")
				.map((item) => item.entry.content)
				.sort(),
		).toEqual(["山后埋着历代断剑，夜里会响。", "山门旁立了一块新碑。"]);
		const afterUpgrade = (await (
			await request(running.origin, "/api/stories/story-1/card")
		).json()) as { card: { version: string } };
		expect(afterUpgrade.card.version).not.toBe(before.card.version);

		const repeat = await post(
			running.origin,
			"/api/stories/story-1/card/diff",
			{ card: payload },
		);
		expect(await repeat.json()).toMatchObject({
			same: true,
			added: [],
			changed: [],
			removed: [],
		});
	});
});

describe("设置接口", () => {
	it("读取默认设置并合并更新", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		const initial = await request(
			running.origin,
			"/api/stories/story-1/settings",
		);
		expect(initial.status).toBe(200);
		const defaults = (await initial.json()) as { budgetTokens: number };
		expect(defaults.budgetTokens).toBe(12_000);

		const updated = await put(running.origin, "/api/stories/story-1/settings", {
			budgetTokens: 9000,
			structuredOutput: "function-call",
		});
		expect(updated.status).toBe(200);
		const settings = (await updated.json()) as {
			budgetTokens: number;
			structuredOutput: string;
		};
		expect(settings.budgetTokens).toBe(9000);
		expect(settings.structuredOutput).toBe("function-call");

		const reread = await request(
			running.origin,
			"/api/stories/story-1/settings",
		);
		expect(
			((await reread.json()) as { budgetTokens: number }).budgetTokens,
		).toBe(9000);
	});

	it("非法枚举、越界数值、未知字段与未知模板返回 400", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});

		const badMode = await put(running.origin, "/api/stories/story-1/settings", {
			structuredOutput: "nope",
		});
		expect(badMode.status).toBe(400);
		expect((await errorBody(badMode)).error.details).toEqual({
			path: "structuredOutput",
		});

		const badDirectorMode = await put(
			running.origin,
			"/api/stories/story-1/settings",
			{ directorConfig: { ...DEFAULT_DIRECTOR_CONFIG, mode: "maybe" } },
		);
		expect(badDirectorMode.status).toBe(400);
		expect((await errorBody(badDirectorMode)).error.details).toEqual({
			path: "directorConfig.mode",
		});

		const badTemperature = await put(
			running.origin,
			"/api/stories/story-1/settings",
			{ temperature: 3 },
		);
		expect(badTemperature.status).toBe(400);
		expect((await errorBody(badTemperature)).error.details).toEqual({
			path: "temperature",
		});

		const unknownField = await put(
			running.origin,
			"/api/stories/story-1/settings",
			{ nope: 1 },
		);
		expect(unknownField.status).toBe(400);
		expect((await errorBody(unknownField)).error.details).toEqual({
			path: "nope",
		});

		const unknownTemplate = await put(
			running.origin,
			"/api/stories/story-1/settings",
			{ templateId: "missing" },
		);
		expect(unknownTemplate.status).toBe(400);
		expect((await errorBody(unknownTemplate)).error.details).toEqual({
			path: "templateId",
		});

		const missing = await request(running.origin, "/api/stories/none/settings");
		expect(missing.status).toBe(404);
	});

	it("返回故事实际使用的模板与 block_format 段", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		const initial = await request(
			running.origin,
			"/api/stories/story-1/template",
		);
		expect(initial.status).toBe(200);
		const fallback = (await initial.json()) as {
			source: string;
			templateId: string | null;
			template: { segments: readonly { id: string }[] };
			blockFormatSegment: { id: string; text: string };
		};
		expect(fallback.source).toBe("default");
		expect(fallback.templateId).toBeNull();
		expect(fallback.template.segments.at(-1)?.id).toBe("protocol");
		expect(fallback.blockFormatSegment.id).toBe("block_format");
		expect(fallback.blockFormatSegment.text).toContain("<state_update>");

		const switched = await put(
			running.origin,
			"/api/stories/story-1/settings",
			{ contextLayout: "full" },
		);
		expect(switched.status).toBe(200);
		const fullView = (await (
			await request(running.origin, "/api/stories/story-1/template")
		).json()) as { template: { segments: readonly { id: string }[] } };
		expect(fullView.template.segments.map((segment) => segment.id)).toEqual([
			"character",
			"lore",
			"state",
			"summary",
			"memory",
			"scene",
			"profile",
			"reunion",
			"scene_card",
			"blueprint",
			"director",
			"user_will",
			"history",
			"protocol",
		]);

		const invalid = await put(running.origin, "/api/stories/story-1/settings", {
			contextLayout: "staggered",
		});
		expect(invalid.status).toBe(400);
		expect((await errorBody(invalid)).error.details).toEqual({
			path: "contextLayout",
		});

		const created = await post(running.origin, "/api/templates", {
			name: "模板甲",
			template: validTemplate,
		});
		const record = (await created.json()) as { id: string };
		await put(running.origin, "/api/stories/story-1/settings", {
			templateId: record.id,
			structuredOutput: "function-call",
		});
		const stored = await request(
			running.origin,
			"/api/stories/story-1/template",
		);
		const view = (await stored.json()) as {
			source: string;
			templateId: string;
			template: { id: string };
			blockFormatSegment: { text: string };
		};
		expect(view.source).toBe("stored");
		expect(view.templateId).toBe(record.id);
		expect(view.template.id).toBe(validTemplate.id);
		expect(view.blockFormatSegment.text).not.toContain("<state_update>");

		const missing = await request(running.origin, "/api/stories/none/template");
		expect(missing.status).toBe(404);
	});
});

describe("功能开关接口", () => {
	it("按卡的能力返回分组开关，档位与覆盖都写进故事设置", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});

		const empty = await request(
			running.origin,
			"/api/stories/story-1/features",
		);
		expect(empty.status).toBe(200);
		const emptyView = (await empty.json()) as StoryFeatureView;
		expect(emptyView.tier).toBe("standard");
		expect(emptyView.groups.map((group) => group.group)).toEqual([
			"memory",
			"director",
			"presentation",
			"compat",
		]);
		expect(
			emptyView.groups.flatMap((group) =>
				group.switches.map((item) => item.id),
			),
		).toEqual([
			"scribe",
			"search",
			"prepare",
			"review",
			"director",
			"promiseLimit",
			"choices",
			"draw",
			"tools",
		]);

		running.store.upsertEntity({
			storyId: "story-1",
			kind: "character",
			name: "云裳",
			source: "card",
		});
		running.store.saveImportAuditEntries("story-1", [
			{
				source: "world-info:旧世:0",
				title: "属性",
				content: "体力上限 10。",
				matches: [{ kind: "state", rules: ["json:state"] }],
				rulePrimary: "state",
				constant: false,
			},
		]);
		running.store.replaceStoryRules({
			storyId: "story-1",
			rules: [
				{
					id: "sword",
					label: "剑术检定",
					target: "剑术",
					difficulty: 12,
					resource: null,
				},
			],
		});

		const saved = await put(running.origin, "/api/stories/story-1/settings", {
			featureTier: "lite",
			featureSwitches: { draw: "manual" },
		});
		expect(saved.status).toBe(200);
		const settings = (await saved.json()) as StorySettings;
		expect(settings.featureTier).toBe("lite");
		expect(settings.featureSwitches).toEqual({ draw: "manual" });

		const filled = await request(
			running.origin,
			"/api/stories/story-1/features",
		);
		const filledView = (await filled.json()) as StoryFeatureView;
		expect(filledView.tier).toBe("lite");
		const switches = new Map(
			filledView.groups.flatMap((group) =>
				group.switches.map((item) => [item.id, item] as const),
			),
		);
		expect(switches.get("draw")?.value).toBe("manual");
		expect(switches.get("archive")?.value).toBe(false);
		expect(switches.get("rules")?.value).toBe(false);
		expect(switches.get("status")?.value).toBe(true);
		expect(switches.get("promiseLimit")?.value).toBe(3);

		const cleared = await put(running.origin, "/api/stories/story-1/settings", {
			featureTier: "immersive",
		});
		expect(cleared.status).toBe(200);
		expect(((await cleared.json()) as StorySettings).featureSwitches).toEqual(
			{},
		);

		const badSwitch = await put(
			running.origin,
			"/api/stories/story-1/settings",
			{ featureSwitches: { director: "sometimes" } },
		);
		expect(badSwitch.status).toBe(400);
		expect((await errorBody(badSwitch)).error.details).toEqual({
			path: "featureSwitches",
		});

		const badTier = await put(running.origin, "/api/stories/story-1/settings", {
			featureTier: "huge",
		});
		expect(badTier.status).toBe(400);
		expect((await errorBody(badTier)).error.details).toEqual({
			path: "featureTier",
		});

		const missing = await request(running.origin, "/api/stories/none/features");
		expect(missing.status).toBe(404);
	});
});

describe("模板接口", () => {
	it("创建、列出、读取、更新与删除模板", async () => {
		const { running } = await startTestServer();
		const created = await post(running.origin, "/api/templates", {
			name: "模板甲",
			template: validTemplate,
		});
		expect(created.status).toBe(201);
		const record = (await created.json()) as { id: string; name: string };
		expect(record.name).toBe("模板甲");

		const list = await request(running.origin, "/api/templates");
		expect(((await list.json()) as unknown[]).length).toBe(1);

		const detail = await request(running.origin, `/api/templates/${record.id}`);
		expect(detail.status).toBe(200);

		const renamed = await put(running.origin, `/api/templates/${record.id}`, {
			name: "模板乙",
		});
		expect(renamed.status).toBe(200);
		expect(((await renamed.json()) as { name: string }).name).toBe("模板乙");

		const deleted = await request(
			running.origin,
			`/api/templates/${record.id}`,
			{ method: "DELETE" },
		);
		expect(deleted.status).toBe(204);
		expect(running.store.listContextTemplates()).toHaveLength(0);
	});

	it("非法模板、重名、未知模板与仍被引用的模板返回 400、409 与 404", async () => {
		const { running } = await startTestServer();
		const bad = await post(running.origin, "/api/templates", {
			name: "坏模板",
			template: { id: "", segments: [] },
		});
		expect(bad.status).toBe(400);
		expect((await errorBody(bad)).error.details).toEqual({ path: "template" });

		const badCondition = await post(running.origin, "/api/templates", {
			name: "条件模板",
			template: {
				id: "bad-condition",
				segments: [
					{
						id: "intro",
						kind: "static",
						text: "从这里开始。",
						when: { kind: "switch", name: "" },
					},
				],
			},
		});
		expect(badCondition.status).toBe(400);
		const conditionBody = await errorBody(badCondition);
		expect(conditionBody.error.details).toEqual({
			path: "template",
		});
		expect(conditionBody.error.message).toContain("switch.name");

		const created = await post(running.origin, "/api/templates", {
			name: "模板甲",
			template: validTemplate,
		});
		const record = (await created.json()) as { id: string };

		const duplicate = await post(running.origin, "/api/templates", {
			name: "模板甲",
			template: validTemplate,
		});
		expect(duplicate.status).toBe(409);
		expect((await errorBody(duplicate)).error.details).toEqual({
			path: "name",
		});

		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "山门",
		});
		await put(running.origin, "/api/stories/story-1/settings", {
			templateId: record.id,
		});
		const inUse = await request(running.origin, `/api/templates/${record.id}`, {
			method: "DELETE",
		});
		expect(inUse.status).toBe(409);
		expect((await errorBody(inUse)).error.details).toEqual({
			storyId: "story-1",
		});

		const missing = await request(running.origin, "/api/templates/missing");
		expect(missing.status).toBe(404);
	});
});

describe("书架楼层编号", () => {
	it("超过 80 楼时编号接着整条路径往下数，不从头重来", async () => {
		const { running } = await startTestServer();
		await post(running.origin, "/api/stories", {
			id: "story-1",
			title: "长路",
		});
		let parentId: string | null = null;
		for (let index = 1; index <= 85; index += 1) {
			const node = running.store.appendNode({
				storyId: "story-1",
				parentId,
				role: "assistant",
				raw: `第 ${index} 楼的正文。`,
			});
			parentId = node.id;
		}

		const response = await request(
			running.origin,
			"/api/stories/story-1/floors",
		);
		expect(response.status).toBe(200);
		const view = (await response.json()) as {
			headNodeId: string;
			floors: { nodeId: string; no: number }[];
		};
		expect(view.floors).toHaveLength(80);
		expect(view.floors[0]?.no).toBe(6);
		expect(view.floors.at(-1)?.no).toBe(85);
		expect(view.floors.at(-1)?.nodeId).toBe(view.headNodeId);
	});
});
