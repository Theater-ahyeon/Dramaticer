import { satisfies, valid, validRange } from "semver";

/**
 * 版本范围的语法由 semver 定义：精确版本、比较符（`>=`、`<` 等）、
 * `^`、`~`、`*` 以及用空格连接的多段条件。
 */
export function readVersionRange(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw new Error(`${path} 必须是字符串`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${path} 不能是空字符串`);
	}
	if (validRange(trimmed) === null) {
		throw new Error(`${path} 不是合法的版本范围：${trimmed}`);
	}
	return trimmed;
}

/** 已安装版本必须是 semver 三段式；不合法时直接抛错，不按范围猜测。 */
export function assertInstalledVersion(version: string, path: string): void {
	if (valid(version) === null) {
		throw new Error(`${path} 不是合法的版本号：${version}`);
	}
}

/** 判断已安装版本是否满足声明范围；预发布版本按 semver 默认规则排除。 */
export function versionSatisfies(version: string, range: string): boolean {
	return satisfies(version, range);
}
