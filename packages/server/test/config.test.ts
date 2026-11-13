import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_HOST,
	DEFAULT_PORT,
	assertBindAllowed,
	isLoopbackHost,
	parseServerArgs,
	repoRoot,
} from "../src/index.js";

const cwd = path.resolve(".tmp-work");

describe("parseServerArgs", () => {
	it("默认值从仓库根目录出发，密码来自环境变量", () => {
		const config = parseServerArgs([], {
			env: { DRAMATICER_SERVER_PASSWORD: "secret" },
			cwd,
		});
		expect(config.port).toBe(DEFAULT_PORT);
		expect(config.host).toBe(DEFAULT_HOST);
		expect(config.dbPath).toBe(path.join(repoRoot, "data", "dramaticer.db"));
		expect(config.channelsPath).toBe(
			path.join(repoRoot, "data", "channels.yaml"),
		);
		expect(config.imagesPath).toBe(path.join(repoRoot, "data", "images.yaml"));
		expect(config.docsRoot).toBe(path.join(repoRoot, "docs"));
		expect(config.webRoot).toBe(path.join(repoRoot, "packages", "web", "dist"));
		expect(config.password).toBe("secret");
	});

	it("空密码与缺失的密码都视为没有设置", () => {
		expect(
			parseServerArgs([], { env: { DRAMATICER_SERVER_PASSWORD: "" }, cwd })
				.password,
		).toBeNull();
		expect(parseServerArgs([], { env: {}, cwd }).password).toBeNull();
	});

	it("命令行参数覆盖默认值，相对路径按工作目录解析", () => {
		const config = parseServerArgs(
			[
				"--db",
				"state/story.db",
				"--port",
				"9000",
				"--host",
				"0.0.0.0",
				"--channels",
				"conf/channels.yaml",
				"--images",
				"conf/images.yaml",
				"--docs-root",
				"reference",
				"--web",
				"site",
			],
			{ env: {}, cwd },
		);
		expect(config.dbPath).toBe(path.resolve(cwd, "state", "story.db"));
		expect(config.port).toBe(9000);
		expect(config.host).toBe("0.0.0.0");
		expect(config.channelsPath).toBe(
			path.resolve(cwd, "conf", "channels.yaml"),
		);
		expect(config.imagesPath).toBe(path.resolve(cwd, "conf", "images.yaml"));
		expect(config.docsRoot).toBe(path.resolve(cwd, "reference"));
		expect(config.webRoot).toBe(path.resolve(cwd, "site"));
	});

	it("非法端口、缺少值与未知参数都直接抛错", () => {
		expect(() => parseServerArgs(["--port", "abc"], { env: {}, cwd })).toThrow(
			"端口必须是整数",
		);
		expect(() => parseServerArgs(["--port", "0"], { env: {}, cwd })).toThrow(
			"端口必须在 1 到 65535 之间",
		);
		expect(() =>
			parseServerArgs(["--port", "70000"], { env: {}, cwd }),
		).toThrow("端口必须在 1 到 65535 之间");
		expect(() => parseServerArgs(["--db"], { env: {}, cwd })).toThrow(
			"参数 --db 缺少值",
		);
		expect(() => parseServerArgs(["--style", "x"], { env: {}, cwd })).toThrow(
			"未知参数 --style",
		);
	});
});

describe("回环地址与密码", () => {
	it("回环地址的几种写法都判定为回环", () => {
		expect(isLoopbackHost("127.0.0.1")).toBe(true);
		expect(isLoopbackHost("127.0.0.53")).toBe(true);
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("::1")).toBe(true);
		expect(isLoopbackHost("[::1]")).toBe(true);
		expect(isLoopbackHost("0.0.0.0")).toBe(false);
		expect(isLoopbackHost("192.168.1.5")).toBe(false);
	});

	it("非回环地址必须有密码", () => {
		expect(() => assertBindAllowed("0.0.0.0", null)).toThrow(
			/DRAMATICER_SERVER_PASSWORD/,
		);
		expect(() => assertBindAllowed("192.168.1.5", "")).toThrow(
			/DRAMATICER_SERVER_PASSWORD/,
		);
		expect(() => assertBindAllowed("0.0.0.0", "pw")).not.toThrow();
		expect(() => assertBindAllowed("127.0.0.1", null)).not.toThrow();
	});
});
