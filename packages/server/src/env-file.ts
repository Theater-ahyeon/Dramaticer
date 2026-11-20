import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

/** 环境变量名：大写字母开头，只含大写字母、数字与下划线。 */
export const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** 密钥值：可打印、不含空白与引号；API key 都满足。 */
const VALUE_PATTERN = /^[\x21\x23-\x26\x28-\x7e]{1,4096}$/;

export function assertEnvValue(value: string): void {
	if (!VALUE_PATTERN.test(value)) {
		throw new Error("密钥只能包含可打印字符，不能有空格、换行或引号");
	}
}

/**
 * 在 env 文件里写入或替换一行 `NAME=value`，其它行（含注释）原样保留；
 * 先写临时文件再改名，写到一半不会留下损坏的文件。文件不存在时新建。
 */
export async function upsertEnvFile(
	filePath: string,
	name: string,
	value: string,
): Promise<void> {
	if (!ENV_NAME_PATTERN.test(name)) {
		throw new Error(`环境变量名不合法：${name}`);
	}
	assertEnvValue(value);
	let text = "";
	try {
		text = await readFile(filePath, "utf8");
	} catch (error) {
		if (
			!(error instanceof Error && "code" in error && error.code === "ENOENT")
		) {
			throw error;
		}
	}
	const line = `${name}=${value.includes("#") ? `"${value}"` : value}`;
	const pattern = new RegExp(`^\\s*(export\\s+)?${name}\\s*=.*$`);
	const lines = text.length === 0 ? [] : text.split(/\r?\n/);
	let replaced = false;
	const next = lines.map((current) => {
		if (!replaced && pattern.test(current)) {
			replaced = true;
			return line;
		}
		return current;
	});
	if (!replaced) {
		while (next.length > 0 && next[next.length - 1] === "") next.pop();
		next.push(line, "");
	}
	const tempPath = `${filePath}.${randomUUID()}.tmp`;
	await writeFile(tempPath, next.join("\n"), { encoding: "utf8", mode: 0o600 });
	await rename(tempPath, filePath);
}
