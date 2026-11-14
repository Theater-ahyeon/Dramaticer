import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-media-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
}

async function startTestServer(
	options: { readonly password?: string } = {},
): Promise<TestServer> {
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
		password: options.password ?? null,
		log: () => {},
	});
	onTestFinished(() => running.close());
	return { running, dir };
}

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

/** 最小的 1x1 PNG，带 chara 文本块；字节本身用作封面原图。 */
function buildPngCard(card: unknown): Buffer {
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
	]);
}

const pngCard = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "云裳",
		description: "青云宗剑修",
		first_mes: "山门外的风很冷。",
		assets: [{ type: "icon", uri: "ccdefault:", name: "云裳.png", ext: "png" }],
	},
};

const jsonCard = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "雾行者",
		description: "在雾里辨路的向导",
		first_mes: "雾又起来了。",
	},
};

async function createStory(
	running: RunningServer,
	id: string,
	title: string,
): Promise<void> {
	const created = await fetch(`${running.origin}/api/stories`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ id, title }),
	});
	expect(created.status).toBe(201);
}

async function importCard(
	running: RunningServer,
	storyId: string,
	card: { format: "png"; bytes: Buffer } | { format: "json"; text: string },
): Promise<Response> {
	const body =
		card.format === "png"
			? {
					card: {
						format: "png",
						data: card.bytes.toString("base64"),
					},
				}
			: { card: { format: "json", data: card.text } };
	return fetch(`${running.origin}/api/stories/${storyId}/import`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("故事封面与人物立绘", () => {
	it("PNG 卡导入后封面与立绘返回原图字节", async () => {
		const { running } = await startTestServer();
		await createStory(running, "story-cover", "山门");
		const png = buildPngCard(pngCard);
		const imported = await importCard(running, "story-cover", {
			format: "png",
			bytes: png,
		});
		expect(imported.status).toBe(200);

		const cover = await fetch(
			`${running.origin}/api/stories/story-cover/media/cover`,
		);
		expect(cover.status).toBe(200);
		expect(cover.headers.get("content-type")).toBe("image/png");
		expect(Buffer.from(await cover.arrayBuffer())).toEqual(png);

		const portrait = await fetch(
			`${running.origin}/api/stories/story-cover/media/portrait/${encodeURIComponent("云裳")}`,
		);
		expect(portrait.status).toBe(200);
		expect(portrait.headers.get("content-type")).toBe("image/png");
		expect(Buffer.from(await portrait.arrayBuffer())).toEqual(png);

		const missing = await fetch(
			`${running.origin}/api/stories/story-cover/media/portrait/${encodeURIComponent("路人")}`,
		);
		expect(missing.status).toBe(404);
	});

	it("重复导入 JSON 卡清掉旧封面并显示 2:3 占位图", async () => {
		const { running } = await startTestServer();
		await createStory(running, "story-json", "雾港纪事");
		const png = buildPngCard(pngCard);
		expect(
			(await importCard(running, "story-json", { format: "png", bytes: png }))
				.status,
		).toBe(200);
		expect(
			(
				await importCard(running, "story-json", {
					format: "json",
					text: JSON.stringify(jsonCard),
				})
			).status,
		).toBe(200);

		const cover = await fetch(
			`${running.origin}/api/stories/story-json/media/cover`,
		);
		expect(cover.status).toBe(200);
		expect(cover.headers.get("content-type")).toBe(
			"image/svg+xml; charset=utf-8",
		);
		const svg = await cover.text();
		expect(svg).toContain('width="600" height="900"');
		expect(svg).toContain("雾港纪事");

		const portrait = await fetch(
			`${running.origin}/api/stories/story-json/media/portrait/${encodeURIComponent("云裳")}`,
		);
		expect(portrait.status).toBe(404);
	});

	it("占位图按标题生成并转义 XML 字符", async () => {
		const { running } = await startTestServer();
		await createStory(running, "story-placeholder", "雾&港<纪>");
		const cover = await fetch(
			`${running.origin}/api/stories/story-placeholder/media/cover`,
		);
		expect(cover.status).toBe(200);
		expect(cover.headers.get("content-type")).toBe(
			"image/svg+xml; charset=utf-8",
		);
		const svg = await cover.text();
		expect(svg).toContain("雾&amp;港&lt;纪&gt;");
		expect(svg).not.toContain("雾&港<纪>");
	});

	it("未认证时媒体接口拒绝，故事不存在时返回 404", async () => {
		const { running } = await startTestServer({ password: "pw" });
		running.store.createStory({ id: "story-auth", title: "山门" });
		const denied = await fetch(
			`${running.origin}/api/stories/story-auth/media/cover`,
		);
		expect(denied.status).toBe(401);

		const loginResponse = await fetch(`${running.origin}/api/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "pw" }),
		});
		expect(loginResponse.status).toBe(204);
		const cookie =
			(loginResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

		const allowed = await fetch(
			`${running.origin}/api/stories/story-auth/media/cover`,
			{ headers: { cookie } },
		);
		expect(allowed.status).toBe(200);

		const unknown = await fetch(
			`${running.origin}/api/stories/missing-story/media/cover`,
			{ headers: { cookie } },
		);
		expect(unknown.status).toBe(404);
	});
});
