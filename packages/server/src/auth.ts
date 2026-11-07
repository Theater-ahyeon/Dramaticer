import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "dramaticer_session";
export const SERVER_PASSWORD_ENV = "DRAMATICER_SERVER_PASSWORD";

/** 会话只存在内存里：进程重启后全部失效。 */
export interface SessionStore {
	create(): string;
	has(token: string): boolean;
}

export function createSessionStore(): SessionStore {
	const tokens = new Set<string>();
	return {
		create(): string {
			const token = randomBytes(32).toString("hex");
			tokens.add(token);
			return token;
		},
		has(token: string): boolean {
			return tokens.has(token);
		},
	};
}

export function isLoopbackHost(host: string): boolean {
	const normalized = host.trim().toLowerCase();
	if (
		normalized === "localhost" ||
		normalized === "::1" ||
		normalized === "[::1]"
	) {
		return true;
	}
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

export function assertBindAllowed(host: string, password: string | null): void {
	if (!isLoopbackHost(host) && (password === null || password.length === 0)) {
		throw new Error(
			`绑定非回环地址 ${host} 时必须设置 ${SERVER_PASSWORD_ENV}，否则网络里的任何人都能读写这个库`,
		);
	}
}

/** 先取摘要再比较，长度不同时也不会从计时差异里推断密码。 */
export function verifyPassword(provided: string, expected: string): boolean {
	const left = createHash("sha256").update(provided, "utf8").digest();
	const right = createHash("sha256").update(expected, "utf8").digest();
	return timingSafeEqual(left, right);
}

export function readSessionToken(
	cookieHeader: string | undefined,
): string | null {
	if (cookieHeader === undefined) return null;
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		const separator = trimmed.indexOf("=");
		if (separator < 0) continue;
		if (trimmed.slice(0, separator) !== SESSION_COOKIE_NAME) continue;
		const value = trimmed.slice(separator + 1).trim();
		return value.length > 0 ? value : null;
	}
	return null;
}

export function buildSessionCookie(token: string): string {
	return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/** 非读取类方法都会改变状态，需要校验 Origin。 */
export function isUnsafeMethod(method: string | undefined): boolean {
	return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * 浏览器发起的跨站请求一定带 Origin，同站请求带的是自己的地址。
 * 没有 Origin 的是命令行客户端，不构成 CSRF。
 */
export function isAllowedOrigin(
	origin: string | undefined,
	host: string | undefined,
): boolean {
	if (origin === undefined) return true;
	if (host === undefined) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
