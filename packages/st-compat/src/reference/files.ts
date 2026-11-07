import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE = /\.(txt|md)$/i;

/** 列出参照目录里的文本文件（绝对路径），按文件名排序；目录不存在时返回空数组。 */
export async function listReferenceFiles(
	referenceRoot: string,
): Promise<readonly string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(referenceRoot, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile() && TEXT_FILE.test(entry.name))
		.map((entry) => entry.name)
		.sort((left, right) => {
			if (left < right) return -1;
			if (left > right) return 1;
			return 0;
		})
		.map((name) => path.join(referenceRoot, name));
}

/** 读取 UTF-8 文本并去掉 BOM。 */
export async function readReferenceText(filePath: string): Promise<string> {
	const text = await readFile(filePath, "utf8");
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}
