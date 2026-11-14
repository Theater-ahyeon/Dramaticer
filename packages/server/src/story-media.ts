import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { StoryMediaRecord, StoryStore } from "@dramaticer/core";

const STORY_MEDIA_ROOT = "story-media";

export interface StoryMediaFile {
	readonly bytes: Buffer;
	readonly mediaType: string;
}

/**
 * 把导入的角色卡 PNG 存进媒体目录，并登记封面与人物立绘。
 * 同一张卡重复导入按内容哈希复用同一个文件；JSON 卡清空旧图片。
 * 调用方负责事务：删除旧记录与写入新记录要一起生效。
 */
export async function saveImportedCardMedia(options: {
	readonly store: StoryStore;
	readonly storyId: string;
	readonly mediaDir: string;
	readonly cardName: string;
	readonly pngBytes: Uint8Array | null;
}): Promise<void> {
	const { store, storyId, mediaDir, cardName, pngBytes } = options;
	store.clearStoryMedia(storyId);
	if (pngBytes === null) return;
	const bytes = Buffer.from(pngBytes);
	const digest = createHash("sha256").update(bytes).digest("hex");
	// 目录取故事 id 的摘要：故事 id 可以包含任何字符，不能直接拼进路径。
	const storyDigest = createHash("sha256")
		.update(storyId, "utf8")
		.digest("hex")
		.slice(0, 16);
	const fileName = `${STORY_MEDIA_ROOT}/${storyDigest}/${digest.slice(0, 32)}.png`;
	const target = resolve(mediaDir, ...fileName.split("/"));
	if (!isInsideDirectory(mediaDir, target)) {
		throw new Error(`故事媒体路径越界：${fileName}`);
	}
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, bytes);
	store.insertStoryMedia(storyId, {
		slot: "cover",
		name: "cover",
		fileName,
		mediaType: "image/png",
		byteSize: bytes.length,
	});
	const portraitName = cardName.trim();
	if (portraitName.length > 0) {
		store.insertStoryMedia(storyId, {
			slot: "portrait",
			name: portraitName,
			fileName,
			mediaType: "image/png",
			byteSize: bytes.length,
		});
	}
}

/** 读取一条媒体记录指向的文件；记录在但文件缺失时返回 null。 */
export async function readStoryMediaFile(
	mediaDir: string,
	record: StoryMediaRecord,
): Promise<StoryMediaFile | null> {
	const filePath = await resolveMediaFile(mediaDir, record.fileName);
	if (filePath === null) return null;
	try {
		return { bytes: await readFile(filePath), mediaType: record.mediaType };
	} catch {
		return null;
	}
}

/**
 * 解析媒体目录里的文件。解析后必须仍在 `mediaDir` 里，软链接也要通过
 * 真实路径检查。
 */
export async function resolveMediaFile(
	mediaDir: string,
	fileName: string,
): Promise<string | null> {
	const target = resolve(mediaDir, fileName);
	if (!isInsideDirectory(mediaDir, target)) return null;
	let realTarget: string;
	let realRoot: string;
	try {
		realRoot = await realpath(mediaDir);
		realTarget = await realpath(target);
	} catch {
		return null;
	}
	if (!isInsideDirectory(realRoot, realTarget)) return null;
	const info = await stat(realTarget).catch(() => null);
	if (info === null || !info.isFile()) return null;
	return realTarget;
}

export function isInsideDirectory(root: string, candidate: string): boolean {
	const relativePath = relative(root, candidate);
	return (
		relativePath.length > 0 &&
		relativePath !== ".." &&
		!relativePath.startsWith(`..${sep}`) &&
		!isAbsolute(relativePath)
	);
}
