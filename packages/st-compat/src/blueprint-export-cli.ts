import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StoryStore } from "@dramaticer/core";
import { attachBlueprintExtension } from "./blueprint-export.js";
import { parseCharacterCardFile } from "./character-card.js";

const USAGE = [
	"用法：pnpm --filter @dramaticer/st-compat blueprint-export --card <路径> --db <路径> --story <id> --out <路径>",
	"",
	"把故事的蓝图写进原卡 JSON 的 extensions.dramaticer.blueprint，导出成新的卡文件；",
	"卡里其他字段逐字保留，酒馆读卡时忽略这个扩展字段。",
	"",
	"选项：",
	"  --card <path>   必填，原卡文件（JSON 或 PNG）",
	"  --db <path>     必填，故事所在的数据库",
	"  --story <id>    必填，要导出的故事",
	"  --out <path>    必填，写出的卡 JSON",
	"  --node <id>     读哪个楼层的蓝图；省略时取当前 head，还没有楼层时取卡导入的默认蓝图",
	"  --help          显示本说明",
].join("\n");

export interface BlueprintExportCliOptions {
	readonly log?: (message: string) => void;
}

export interface BlueprintExportCliResult {
	readonly outPath: string;
	readonly entries: number;
}

/** `blueprint-export`：导出带上蓝图的卡文件。 */
export async function runBlueprintExportCli(
	args: readonly string[],
	options: BlueprintExportCliOptions = {},
): Promise<BlueprintExportCliResult> {
	const log = options.log ?? console.log;
	if (args.includes("--help") || args.includes("-h")) {
		log(USAGE);
		return { outPath: "", entries: 0 };
	}
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (!["card", "db", "story", "out", "node"].includes(key)) {
			throw new Error(`不认识的参数 --${key}；${USAGE}`);
		}
		if (values.has(key)) {
			throw new Error(`参数 --${key} 重复；${USAGE}`);
		}
		const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
		if (equals === -1) index += 1;
		if (value === undefined || value.trim().length === 0) {
			throw new Error(`--${key} 后面必须写值；${USAGE}`);
		}
		values.set(key, value);
	}
	for (const key of ["card", "db", "story", "out"]) {
		if (!values.has(key)) throw new Error(`--${key} 必填；${USAGE}`);
	}
	const cardPath = values.get("card") as string;
	const dbPath = values.get("db") as string;
	const storyId = values.get("story") as string;
	const outPath = values.get("out") as string;
	if (!existsSync(cardPath)) {
		throw new Error(`卡文件不存在：${cardPath}`);
	}
	if (!existsSync(dbPath)) {
		throw new Error(`数据库不存在：${dbPath}`);
	}
	const store = StoryStore.open(dbPath);
	try {
		if (!store.getStory(storyId)) {
			throw new Error(`故事不存在：${storyId}`);
		}
		const card = await parseCharacterCardFile(cardPath);
		const nodeId = values.get("node") ?? store.getHead(storyId)?.id ?? null;
		const entries =
			nodeId === null
				? store.readStoryBlueprintBaseline(storyId)
				: store.readBlueprintEntries(nodeId);
		const next = attachBlueprintExtension(card, entries);
		writeFileSync(outPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		log(`导出 ${entries.length} 条蓝图：${path.resolve(outPath)}`);
		return { outPath, entries: entries.length };
	} finally {
		store.close();
	}
}

async function main(): Promise<void> {
	await runBlueprintExportCli(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (
	entryPath !== undefined &&
	import.meta.url === pathToFileURL(entryPath).href
) {
	await main();
}
