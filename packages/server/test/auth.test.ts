import { describe, expect, it } from "vitest";
import {
	isAllowedOrigin,
	readSessionToken,
	verifyPassword,
} from "../src/index.js";

describe("verifyPassword", () => {
	it("相同密码通过，不同长度与不同内容都不通过", () => {
		expect(verifyPassword("秘密口令", "秘密口令")).toBe(true);
		expect(verifyPassword("秘密口令", "秘密口")).toBe(false);
		expect(verifyPassword("秘密口令", "秘密命令")).toBe(false);
	});
});

describe("readSessionToken", () => {
	it("从多个 cookie 中取出会话 token", () => {
		expect(readSessionToken("theme=dark; dramaticer_session=abc123")).toBe(
			"abc123",
		);
		expect(readSessionToken("dramaticer_session=abc123")).toBe("abc123");
	});

	it("没有 cookie、空值与同名前缀都不算会话", () => {
		expect(readSessionToken(undefined)).toBeNull();
		expect(readSessionToken("dramaticer_session=")).toBeNull();
		expect(readSessionToken("dramaticer_session_old=abc123")).toBeNull();
	});
});

describe("isAllowedOrigin", () => {
	it("没有 Origin 的命令行请求通过，同源请求通过", () => {
		expect(isAllowedOrigin(undefined, "127.0.0.1:8787")).toBe(true);
		expect(isAllowedOrigin("http://127.0.0.1:8787", "127.0.0.1:8787")).toBe(
			true,
		);
	});

	it("跨源、无法解析的 Origin 与缺少 Host 都拒绝", () => {
		expect(isAllowedOrigin("http://127.0.0.1:9999", "127.0.0.1:8787")).toBe(
			false,
		);
		expect(isAllowedOrigin("null", "127.0.0.1:8787")).toBe(false);
		expect(isAllowedOrigin("http://127.0.0.1:8787", undefined)).toBe(false);
	});
});
