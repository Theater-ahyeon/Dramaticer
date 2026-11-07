import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type RunningServer, startServer } from "../src/index.js";

function tempDir(): string {
	const dir = mkdtempSync(join(import.meta.dirname, ".tmp-server-"));
	onTestFinished(() => {
		rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
	});
	return dir;
}

function writeWeb(root: string): void {
	mkdirSync(join(root, "assets"), { recursive: true });
	writeFileSync(join(root, "index.html"), "<!doctype html><title>应用</title>");
	writeFileSync(join(root, "assets", "app.js"), "console.log('app');");
	writeFileSync(join(root, "styles.css"), "body{margin:0}");
}

interface TestServerOptions {
	readonly password?: string;
	readonly maxJsonBodyBytes?: number;
	readonly log?: (line: string) => void;
}

interface TestServer {
	readonly running: RunningServer;
	readonly dir: string;
	readonly webRoot: string;
}

async function startTestServer(
	options: TestServerOptions = {},
): Promise<TestServer> {
	const dir = tempDir();
	const webRoot = join(dir, "web");
	writeWeb(webRoot);
	const running = await startServer({
		dbPath: join(dir, "story.db"),
		webRoot,
		host: "127.0.0.1",
		port: 0,
		password: options.password ?? null,
		maxJsonBodyBytes: options.maxJsonBodyBytes,
		log: options.log,
	});
	onTestFinished(() => running.close());
	return { running, dir, webRoot };
}

function login(
	origin: string,
	password: string,
	headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
	return fetch(`${origin}/api/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ password }),
	});
}

describe("启动与健康检查", () => {
	it("绑定非回环地址且没有密码时拒绝启动", async () => {
		const dir = tempDir();
		await expect(
			startServer({
				dbPath: join(dir, "story.db"),
				webRoot: join(dir, "web"),
				host: "0.0.0.0",
				port: 0,
				password: null,
			}),
		).rejects.toThrow(/DRAMATICER_SERVER_PASSWORD/);
	});

	it("回环地址没有密码时可以直接访问健康检查", async () => {
		const { running } = await startTestServer();
		const response = await fetch(`${running.origin}/api/health`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			status: string;
			schemaVersion: number;
			version: { major: number };
		};
		expect(body.status).toBe("ok");
		expect(typeof body.schemaVersion).toBe("number");
		expect(body.version.major).toBe(0);
	});
});

describe("认证", () => {
	it("错误密码返回 401 与统一错误形状", async () => {
		const { running } = await startTestServer({ password: "正确密码" });
		const response = await login(running.origin, "错误密码");
		expect(response.status).toBe(401);
		const body = (await response.json()) as {
			error: { code: string; message: string };
		};
		expect(body.error.code).toBe("unauthorized");
		expect(body.error.message).toBe("密码错误");
	});

	it("正确密码发会话 cookie，受保护接口要求会话", async () => {
		const { running } = await startTestServer({ password: "正确密码" });
		const before = await fetch(`${running.origin}/api/stories`);
		expect(before.status).toBe(401);

		const loginResponse = await login(running.origin, "正确密码");
		expect(loginResponse.status).toBe(204);
		const setCookie = loginResponse.headers.get("set-cookie") ?? "";
		expect(setCookie).toContain("dramaticer_session=");
		expect(setCookie).toContain("HttpOnly");
		expect(setCookie).toContain("SameSite=Strict");

		const cookie = setCookie.split(";")[0] ?? "";
		const after = await fetch(`${running.origin}/api/stories`, {
			headers: { cookie },
		});
		expect(after.status).toBe(200);
		expect(await after.json()).toEqual([]);
	});

	it("请求体超过上限返回 413", async () => {
		const { running } = await startTestServer({
			password: "pw",
			maxJsonBodyBytes: 16,
		});
		const response = await fetch(`${running.origin}/api/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: "明显超过十六字节的密码" }),
		});
		expect(response.status).toBe(413);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("payload_too_large");
	});

	it("状态变更请求的 Origin 必须与 Host 一致", async () => {
		const { running } = await startTestServer({ password: "pw" });
		const otherOrigin = running.origin.replace("127.0.0.1", "localhost");
		const rejected = await login(running.origin, "pw", {
			origin: otherOrigin,
		});
		expect(rejected.status).toBe(403);
		const accepted = await login(running.origin, "pw", {
			origin: running.origin,
		});
		expect(accepted.status).toBe(204);
	});

	it("日志不包含请求正文、密码与会话 cookie", async () => {
		const lines: string[] = [];
		const { running } = await startTestServer({
			password: "top-secret",
			log: (line) => lines.push(line),
		});
		const response = await login(running.origin, "top-secret");
		const cookie =
			(response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		await fetch(`${running.origin}/api/stories`, { headers: { cookie } });
		const log = lines.join("\n");
		expect(log).toContain("POST /api/login 204");
		expect(log).toContain("GET /api/stories 200");
		expect(log).not.toContain("top-secret");
		expect(log).not.toContain(cookie);
		expect(log).not.toContain("password");
	});
});

describe("静态资源", () => {
	it("按扩展名返回 MIME，未知路径回退 index.html", async () => {
		const { running } = await startTestServer();
		const index = await fetch(`${running.origin}/`);
		expect(index.status).toBe(200);
		expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
		expect(await index.text()).toContain("应用");

		const script = await fetch(`${running.origin}/assets/app.js`);
		expect(script.status).toBe(200);
		expect(script.headers.get("content-type")).toBe(
			"text/javascript; charset=utf-8",
		);

		const style = await fetch(`${running.origin}/styles.css`);
		expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8");

		const spa = await fetch(`${running.origin}/stories/abc/chat`);
		expect(spa.status).toBe(200);
		expect(spa.headers.get("content-type")).toBe("text/html; charset=utf-8");
	});

	it("拒绝编码后的上级目录", async () => {
		const { running } = await startTestServer();
		const response = await fetch(`${running.origin}/..%2fsecret.txt`);
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: { code: string } };
		expect(body.error.code).toBe("forbidden");
	});

	it("拒绝逃出 web 目录的符号链接", async () => {
		const { running, dir } = await startTestServer();
		const outside = join(dir, "outside");
		mkdirSync(outside);
		writeFileSync(join(outside, "secret.txt"), "SECRET");
		symlinkSync(outside, join(dir, "web", "link"), "junction");
		const response = await fetch(`${running.origin}/link/secret.txt`);
		expect(response.status).toBe(403);
		expect(await response.text()).not.toContain("SECRET");
	});
});
