import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "@dramaticer/core";

export type CorpusGroup = "legacy" | "latest" | "shared";

/** 评测使用的两个对话语料分组；预设不分语料。 */
export type StoryCorpus = Exclude<CorpusGroup, "shared">;

export const STORY_CORPORA: readonly StoryCorpus[] = ["legacy", "latest"];

const CORPUS_GROUPS: readonly CorpusGroup[] = ["legacy", "latest", "shared"];

/** 旧清单没有 corpus 字段，这些条目属于 legacy 语料。 */
export function isLegacyCorpus(file: SnapshotManifestFile): boolean {
	return file.corpus === undefined || file.corpus === "legacy";
}

/** 对话条目所属的语料分组；旧清单没有 corpus 字段时按 legacy 处理。 */
export function storyCorpus(file: SnapshotManifestFile): StoryCorpus {
	if (file.role !== "chat") {
		throw new Error(`只有 chat 条目才有语料分组：${file.target}`);
	}
	if (file.corpus === "shared") {
		throw new Error(`chat 条目不能属于 shared 语料：${file.target}`);
	}
	return file.corpus ?? "legacy";
}

export interface SnapshotManifestFile {
	readonly role: string;
	readonly character?: string;
	readonly corpus?: CorpusGroup;
	readonly sourceMtime?: string;
	readonly target: string;
	readonly size: number;
	readonly sha256: string;
}

export interface SnapshotManifest {
	readonly generatedAt: string | null;
	readonly files: readonly SnapshotManifestFile[];
}

export interface Snapshot {
	readonly manifest: SnapshotManifest;
	filesByRole(role: string): readonly SnapshotManifestFile[];
	/** 校验 manifest 里的大小与 sha256 之后返回绝对路径。 */
	resolveFile(file: SnapshotManifestFile): Promise<string>;
}

export async function openSnapshot(rawRoot: string): Promise<Snapshot> {
	const root = path.resolve(rawRoot);
	const manifest = await readSnapshotManifest(path.join(root, "manifest.json"));
	const resolved = new Map<string, string>();
	return {
		manifest,
		filesByRole(role) {
			return manifest.files.filter((file) => file.role === role);
		},
		async resolveFile(file) {
			const cached = resolved.get(file.target);
			if (cached !== undefined) return cached;
			const filePath = resolveInside(root, file.target);
			await verifyFile(filePath, file);
			resolved.set(file.target, filePath);
			return filePath;
		},
	};
}

async function readSnapshotManifest(
	manifestPath: string,
): Promise<SnapshotManifest> {
	const text = await readFile(manifestPath, "utf8");
	return parseSnapshotManifest(JSON.parse(text));
}

export function parseSnapshotManifest(value: unknown): SnapshotManifest {
	if (!isJsonObject(value)) {
		throw new Error("manifest 根必须是对象");
	}
	if (!Array.isArray(value.files)) {
		throw new Error("manifest.files 必须是数组");
	}
	const files = value.files.map((file, index) => {
		if (!isJsonObject(file)) {
			throw new Error(`manifest.files[${index}] 必须是对象`);
		}
		if (typeof file.role !== "string" || file.role.length === 0) {
			throw new Error(`manifest.files[${index}].role 必须是非空字符串`);
		}
		if (typeof file.target !== "string" || file.target.length === 0) {
			throw new Error(`manifest.files[${index}].target 必须是非空字符串`);
		}
		if (file.character !== undefined && typeof file.character !== "string") {
			throw new Error(`manifest.files[${index}].character 必须是字符串`);
		}
		if (
			file.corpus !== undefined &&
			!CORPUS_GROUPS.includes(file.corpus as CorpusGroup)
		) {
			throw new Error(
				`manifest.files[${index}].corpus 必须是 ${CORPUS_GROUPS.join("、")}`,
			);
		}
		if (
			file.sourceMtime !== undefined &&
			(typeof file.sourceMtime !== "string" ||
				Number.isNaN(Date.parse(file.sourceMtime)))
		) {
			throw new Error(
				`manifest.files[${index}].sourceMtime 必须是 ISO 时间字符串`,
			);
		}
		if (
			typeof file.size !== "number" ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0
		) {
			throw new Error(`manifest.files[${index}].size 必须是非负整数`);
		}
		if (
			typeof file.sha256 !== "string" ||
			!/^[0-9a-f]{64}$/.test(file.sha256)
		) {
			throw new Error(
				`manifest.files[${index}].sha256 必须是 64 位小写十六进制`,
			);
		}
		return {
			role: file.role,
			character: file.character,
			...(file.corpus === undefined
				? {}
				: { corpus: file.corpus as CorpusGroup }),
			...(file.sourceMtime === undefined
				? {}
				: { sourceMtime: file.sourceMtime as string }),
			target: file.target,
			size: file.size,
			sha256: file.sha256,
		};
	});
	return {
		generatedAt:
			typeof value.generatedAt === "string" ? value.generatedAt : null,
		files,
	};
}

function resolveInside(rawRoot: string, target: string): string {
	const resolved = path.resolve(rawRoot, target);
	const relative = path.relative(rawRoot, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`manifest 路径越界：${target}`);
	}
	return resolved;
}

async function verifyFile(
	filePath: string,
	file: SnapshotManifestFile,
): Promise<void> {
	let info: Stats;
	try {
		info = await stat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`快照文件不存在：${file.target}`);
		}
		throw error;
	}
	if (!info.isFile()) {
		throw new Error(`快照路径不是文件：${file.target}`);
	}
	if (info.size !== file.size) {
		throw new Error(
			`快照文件大小与 manifest 不一致：${file.target}（manifest ${file.size} 字节，实际 ${info.size} 字节）`,
		);
	}
	const actual = await sha256File(filePath);
	if (actual !== file.sha256) {
		throw new Error(`快照文件 sha256 与 manifest 不一致：${file.target}`);
	}
}

async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}
