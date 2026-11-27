import type { JsonValue } from "../json.js";

/** 脚本里出现的外部地址最多扫这么多个字符，避免异常输入拖慢导入。 */
const MAX_SCAN_LENGTH = 2_000_000;

const HOSTNAME_PATTERN =
	/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * 从脚本、模板与样式里列出外部域名。只认 http 与 https 地址；
 * 结果小写、去重、排序，本机名不进名单（沙箱默认也不允许联网）。
 */
export function scanSandboxDomains(text: string): string[] {
	const source =
		text.length > MAX_SCAN_LENGTH ? text.slice(0, MAX_SCAN_LENGTH) : text;
	const found = new Set<string>();
	for (const match of source.matchAll(/https?:\/\/[^\s"'`<>()\\]+/gi)) {
		let url: URL;
		try {
			url = new URL(match[0]);
		} catch {
			continue;
		}
		const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
		if (hostname.length === 0 || hostname === "localhost") continue;
		if (!HOSTNAME_PATTERN.test(hostname)) continue;
		found.add(hostname);
	}
	return [...found].sort();
}

/** 多个文本一起扫；用于一张卡的正文、扩展与随卡渲染器。 */
export function scanSandboxDomainsInTexts(texts: readonly string[]): string[] {
	const found = new Set<string>();
	for (const text of texts) {
		for (const domain of scanSandboxDomains(text)) found.add(domain);
	}
	return [...found].sort();
}

/** 允许名单里只保存主机名：小写、无协议、无路径、无端口。 */
export function assertSandboxDomain(value: unknown, label = "域名"): string {
	if (typeof value !== "string") {
		throw new Error(`${label} 必须是字符串`);
	}
	const domain = value.trim().toLowerCase().replace(/\.$/, "");
	if (domain.length === 0 || domain.length > 253) {
		throw new Error(`${label} 必须是 1 到 253 个字符的主机名`);
	}
	if (domain.includes("://") || domain.includes("/")) {
		throw new Error(`${label} 只能是主机名，不带协议或路径：${domain}`);
	}
	if (!HOSTNAME_PATTERN.test(domain)) {
		throw new Error(`${label} 不是合法的主机名：${domain}`);
	}
	return domain;
}

export function normalizeSandboxDomains(
	value: unknown,
	label = "域名列表",
): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} 必须是数组`);
	}
	return value
		.map((item, index) => assertSandboxDomain(item, `${label}[${index}]`))
		.filter((domain, index, all) => all.indexOf(domain) === index);
}

/**
 * 沙箱文档的 CSP。默认什么都不允许；允许的域名同时放进脚本、样式、
 * 图片与请求四类来源。`connect-src` 没有允许项时是 'none'。
 */
export function buildSandboxContentSecurityPolicy(
	allowedDomains: readonly string[],
): string {
	const origins: string[] = [];
	const connect: string[] = [];
	for (const value of allowedDomains) {
		const domain = assertSandboxDomain(value);
		origins.push(`http://${domain}`, `https://${domain}`);
		connect.push(
			`http://${domain}`,
			`https://${domain}`,
			`ws://${domain}`,
			`wss://${domain}`,
		);
	}
	const resource = origins.length === 0 ? "" : ` ${origins.join(" ")}`;
	return [
		"default-src 'none'",
		`script-src 'unsafe-inline'${resource}`,
		`style-src 'unsafe-inline'${resource}`,
		`img-src data: blob:${resource}`,
		`font-src${resource === "" ? " 'none'" : resource}`,
		`media-src data: blob:${resource}`,
		`connect-src ${connect.length === 0 ? "'none'" : connect.join(" ")}`,
	].join("; ");
}

/** 沙箱里的消息只允许普通 JSON；父页面会再按字段白名单收窄。 */
export function isSandboxJsonValue(value: unknown): value is JsonValue {
	if (value === null) return true;
	switch (typeof value) {
		case "string":
		case "boolean":
		case "number":
			return typeof value !== "number" || Number.isFinite(value);
		case "object": {
			if (Array.isArray(value)) return value.every(isSandboxJsonValue);
			if (Object.getPrototypeOf(value) !== Object.prototype) return false;
			return Object.values(value as Record<string, unknown>).every(
				isSandboxJsonValue,
			);
		}
		default:
			return false;
	}
}
