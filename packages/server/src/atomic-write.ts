import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const writeLocks = new Map<string, Promise<void>>();

/** Windows 杀软或索引器可能短时占用目标文件，对临时文件改名做短暂退避重试。 */
async function renameWithRetry(
	tempPath: string,
	targetPath: string,
): Promise<void> {
	const maxAttempts = 6;
	for (let attempt = 1; ; attempt += 1) {
		try {
			await rename(tempPath, targetPath);
			return;
		} catch (error) {
			const code =
				error instanceof Error && "code" in error
					? String(error.code)
					: undefined;
			if (
				attempt >= maxAttempts ||
				code === undefined ||
				!TRANSIENT_RENAME_CODES.has(code)
			) {
				throw error;
			}
			await delay(30 * attempt);
		}
	}
}

/** 先写临时文件再原子改名，并对同一路径串行排队，避免半写入或并发改名竞争。 */
export async function writeFileAtomic(
	filePath: string,
	text: string,
	options?: { mode?: number },
): Promise<void> {
	const key = path.resolve(filePath);
	const previous = writeLocks.get(key) ?? Promise.resolve();
	const current = previous
		.catch(() => undefined)
		.then(async () => {
			const tempPath = `${filePath}.${randomUUID()}.tmp`;
			try {
				await writeFile(tempPath, text, {
					encoding: "utf8",
					...(options?.mode === undefined ? {} : { mode: options.mode }),
				});
				await renameWithRetry(tempPath, filePath);
			} catch (error) {
				await rm(tempPath, { force: true }).catch(() => undefined);
				throw error;
			}
		});
	writeLocks.set(key, current);
	try {
		await current;
	} finally {
		if (writeLocks.get(key) === current) writeLocks.delete(key);
	}
}
