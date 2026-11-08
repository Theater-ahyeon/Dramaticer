// R2-T09.c：把 legacy 评测对话既有的事件题转成遗忘评测可读的记忆题文件。
// 事件题已经带证据楼层与逐字答案，转成 memory 格式时统一归入信息抽取类别；
// 输出只写 eval-private/evalset/，不进入提交。
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const EVALSET_DIR = path.join(ROOT, "eval-private", "evalset");

function sanitize(value) {
	return value.replace(/[\\/:*?"<>|]/g, "_");
}

async function main() {
	const entries = await readdir(EVALSET_DIR);
	const eventFiles = entries
		.filter((name) => name.startsWith("event-") && name.endsWith(".jsonl"))
		.sort();
	if (eventFiles.length === 0) {
		throw new Error(`${EVALSET_DIR} 里没有事件题文件`);
	}
	for (const name of eventFiles) {
		const filePath = path.join(EVALSET_DIR, name);
		const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
		const questions = [];
		const seen = new Set();
		for (const [index, line] of lines.entries()) {
			if (line.trim() === "") continue;
			const label = `${filePath}:${index + 1}`;
			const value = JSON.parse(line);
			if (value.kind !== "event") {
				throw new Error(`${label} 的 kind 是 ${value.kind}，期望 event`);
			}
			if (seen.has(value.id)) {
				throw new Error(`${label} 的 id 重复：${value.id}`);
			}
			seen.add(value.id);
			if (
				typeof value.story !== "string" ||
				typeof value.askAtNode !== "string" ||
				typeof value.question !== "string" ||
				typeof value.answer !== "string" ||
				!Array.isArray(value.evidenceNodes) ||
				value.evidenceNodes.length === 0
			) {
				throw new Error(`${label} 缺少记忆题需要的字段`);
			}
			questions.push({
				id: value.id,
				story: value.story,
				askAtNode: value.askAtNode,
				question: value.question,
				answer: value.answer,
				evidenceNodes: value.evidenceNodes,
				category: "extraction",
				kind: "memory",
				fabricated: false,
			});
		}
		if (questions.length === 0) {
			throw new Error(`${filePath} 没有任何题目`);
		}
		const story = questions[0].story;
		if (questions.some((question) => question.story !== story)) {
			throw new Error(`${filePath} 含多个故事`);
		}
		const outPath = path.join(EVALSET_DIR, `memory-${sanitize(story)}.jsonl`);
		await writeFile(
			outPath,
			`${questions.map((question) => JSON.stringify(question)).join("\n")}\n`,
			"utf8",
		);
		console.log(`${story}：${questions.length} 道题 → ${outPath}`);
	}
}

await main();
