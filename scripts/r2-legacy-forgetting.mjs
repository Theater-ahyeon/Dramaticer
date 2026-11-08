// R2-T09.c：把 legacy 评测对话导入独立数据库，并在 119、219 两个分支点上
// 按 R2-T09.b 的口径跑试玩与跑后提问。私有数据只写 eval-private/。
import { spawn } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { StoryStore } from "../packages/core/dist/index.js";
import { parseCharacterCardFile } from "../packages/st-compat/dist/character-card.js";
import { importChatFileToStore } from "../packages/st-compat/dist/chat-import.js";
import { importCardContent } from "../packages/st-compat/dist/chat/session.js";
import { storyIdOf } from "../packages/st-compat/dist/evalset/question-files.js";
import { runPlaytestCli } from "../packages/st-compat/dist/evalset/playtest-cli.js";
import {
	isLegacyCorpus,
	openSnapshot,
} from "../packages/st-compat/dist/health/manifest.js";
import { parseWorldInfoFile } from "../packages/st-compat/dist/world-info.js";

const ROOT = process.cwd();
const RAW_ROOT = path.join(ROOT, "eval-private", "raw");
const EVALSET_DIR = path.join(ROOT, "eval-private", "evalset");
const WORK_DIR = path.join(ROOT, "eval-private", "reports", "forgetting", "legacy");
const DB_DIR = path.join(WORK_DIR, "db");
const RUN_DIR = path.join(WORK_DIR, "runs");
const PLAYTEST_DIR = path.join(WORK_DIR, "playtest");
const BRANCH_DEPTHS = [119, 219];
const ROUNDS = 20;

function sanitize(value) {
	return value.replace(/[\\/:*?"<>|]/g, "_");
}

async function legacyChats() {
	const snapshot = await openSnapshot(RAW_ROOT);
	const chats = snapshot
		.filesByRole("chat")
		.filter(isLegacyCorpus)
		.sort((left, right) => left.target.localeCompare(right.target));
	if (chats.length === 0) throw new Error("manifest 里没有 legacy 对话");
	return { snapshot, chats };
}

function storyRecord(chats, index) {
	const file = chats[index];
	if (file === undefined) throw new Error(`没有第 ${index} 个 legacy 对话`);
	const story = storyIdOf(file);
	return {
		index,
		file,
		story,
		baseDb: path.join(DB_DIR, `${index}-${sanitize(story)}.db`),
	};
}

async function loadCardAndWorlds(snapshot, character) {
	const cardFile = snapshot
		.filesByRole("card")
		.find((candidate) => (candidate.character ?? "") === character);
	if (cardFile === undefined) throw new Error(`找不到 ${character} 的角色卡`);
	const card = await parseCharacterCardFile(await snapshot.resolveFile(cardFile));
	const worlds = [];
	for (const file of snapshot
		.filesByRole("worldbook")
		.filter((candidate) => (candidate.character ?? "") === character)) {
		worlds.push(await parseWorldInfoFile(await snapshot.resolveFile(file)));
	}
	return { card, worlds };
}

/** 路径深度从 1 开始；取第一个达到目标深度且是助手楼层的节点。 */
function pickBranch(pathNodes, target) {
	for (const [index, node] of pathNodes.entries()) {
		const depth = index + 1;
		if (depth >= target && node.role === "assistant") {
			return { nodeId: node.id, depth };
		}
	}
	throw new Error(`路径上没有达到深度 ${target} 的助手楼层`);
}

async function importStories() {
	mkdirSync(DB_DIR, { recursive: true });
	const { snapshot, chats } = await legacyChats();
	const branches = {};
	for (const [index] of chats.entries()) {
		const record = storyRecord(chats, index);
		let store = StoryStore.open(record.baseDb);
		try {
			if (store.getStory(record.story) === null) {
				const chatPath = await snapshot.resolveFile(record.file);
				const imported = await importChatFileToStore(store, chatPath, {
					storyId: record.story,
				});
				const { card, worlds } = await loadCardAndWorlds(
					snapshot,
					record.file.character ?? record.story,
				);
				const content = importCardContent(store, record.story, {
					card,
					worlds,
				});
				store.updateStorySettings(record.story, {
					cardName: content.cardName,
					characterPrompt: content.characterPrompt,
				});
				console.log(
					`${record.story}：导入 ${imported.nodeCount} 个节点、${imported.mainPathNodeIds.length} 楼主路径`,
				);
			} else {
				console.log(`${record.story}：已存在，跳过导入`);
			}
			const pathNodes = store.getPathToHead(record.story);
			branches[record.story] = {
				index,
				baseDb: record.baseDb,
				floors: pathNodes.length,
				branches: BRANCH_DEPTHS.map((target) => ({
					target,
					...pickBranch(pathNodes, target),
				})),
			};
			console.log(
				`${record.story}：主路径 ${pathNodes.length} 楼，分支点 ${branches[record.story].branches.map((branch) => `${branch.nodeId}（深度 ${branch.depth}）`).join("、")}`,
			);
		} finally {
			store.close();
		}
	}
	mkdirSync(WORK_DIR, { recursive: true });
	await writeFile(
		path.join(WORK_DIR, "branches.json"),
		`${JSON.stringify(branches, null, 2)}\n`,
		"utf8",
	);
}

async function showBranches() {
	const text = await readFile(path.join(WORK_DIR, "branches.json"), "utf8");
	console.log(text);
}

async function runOne(args) {
	const index = Number(args["story-index"]);
	const depth = Number(args.depth);
	const profile = args.profile;
	if (!Number.isInteger(index) || index < 0) {
		throw new Error("--story-index 必须是非负整数");
	}
	if (profile !== "naive" && profile !== "native") {
		throw new Error("--profile 只接受 naive 或 native");
	}
	const { chats } = await legacyChats();
	const record = storyRecord(chats, index);
	const branches = JSON.parse(
		await readFile(path.join(WORK_DIR, "branches.json"), "utf8"),
	);
	const entry = branches[record.story];
	if (entry === undefined) throw new Error(`${record.story} 还没有导入`);
	const branch = entry.branches.find((item) => item.target === depth);
	if (branch === undefined) throw new Error(`没有深度 ${depth} 的分支点`);
	if (!existsSync(record.baseDb)) {
		throw new Error(`基准数据库不存在：${record.baseDb}`);
	}
	for (const dir of [DB_DIR, RUN_DIR, PLAYTEST_DIR]) {
		mkdirSync(dir, { recursive: true });
	}
	const tag = `${index}-${depth}-${profile}`;
	const runDb = path.join(DB_DIR, `run-${tag}.db`);
	const outPath = path.join(PLAYTEST_DIR, `${tag}.jsonl`);
	const questionsOut = path.join(RUN_DIR, `${tag}.json`);
	const resume = args.resume === "true";
	if (resume) {
		if (!existsSync(runDb) || !existsSync(outPath)) {
			throw new Error(`续跑缺少 ${runDb} 或 ${outPath}`);
		}
	} else {
		copyFileSync(record.baseDb, runDb);
	}
	const questionPath = path.join(
		EVALSET_DIR,
		`memory-${sanitize(record.story)}.jsonl`,
	);
	if (!existsSync(questionPath)) {
		throw new Error(`缺少记忆题文件：${questionPath}`);
	}
	console.log(
		`${resume ? "续跑" : "运行"} ${record.story} 深度 ${branch.depth}（${branch.nodeId}）档位 ${profile}：${tag}`,
	);
	const playtestArgs = [
		"--db",
		runDb,
		"--story",
		record.story,
		"--rounds",
		String(ROUNDS),
		"--profile",
		profile,
		"--model",
		"rp",
		"--user-model",
		"background",
		"--judge-model",
		"judge",
		"--probe-every",
		"0",
		"--no-background",
		"--out",
		outPath,
		"--memory-questions",
		questionPath,
		"--questions-out",
		questionsOut,
		"--corpus",
		"legacy",
	];
	if (resume) {
		playtestArgs.push("--resume");
	} else {
		playtestArgs.push("--head", branch.nodeId);
	}
	await runPlaytestCli(playtestArgs);
}

async function runAll(args) {
	const { chats } = await legacyChats();
	const concurrency = Number(args.concurrency ?? 3);
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new Error("--concurrency 必须是正整数");
	}
	const logDir = path.join(WORK_DIR, "logs");
	mkdirSync(logDir, { recursive: true });
	const tasks = [];
	for (const [index] of chats.entries()) {
		for (const depth of BRANCH_DEPTHS) {
			for (const profile of ["naive", "native"]) {
				tasks.push({ index, depth, profile });
			}
		}
	}
	const failures = [];
	let next = 0;
	async function worker() {
		while (next < tasks.length) {
			const task = tasks[next];
			next += 1;
			const tag = `${task.index}-${task.depth}-${task.profile}`;
			if (await isCompleted(tag)) {
				console.log(`跳过已完成 ${tag}`);
				continue;
			}
			let resume = await hasRecords(tag);
			let attempt = 0;
			while (true) {
				const logPath = path.join(
					logDir,
					attempt === 0 ? `${tag}.log` : `${tag}.retry${attempt}.log`,
				);
				console.log(`${resume ? "续跑" : "启动"} ${tag}`);
				try {
					await runChild(task, logPath, resume);
					console.log(`完成 ${tag}`);
					break;
				} catch (error) {
					attempt += 1;
					if (attempt >= 3) {
						failures.push(`${tag}：${error.message}`);
						break;
					}
					console.log(`重试 ${tag}（第 ${attempt} 次）`);
					resume = true;
				}
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
	);
	if (failures.length > 0) {
		throw new Error(`以下运行失败：\n${failures.join("\n")}`);
	}
}

async function isCompleted(tag) {
	const runPath = path.join(RUN_DIR, `${tag}.json`);
	if (!existsSync(runPath)) return false;
	const run = JSON.parse(await readFile(runPath, "utf8"));
	return run.completedRounds >= ROUNDS;
}

async function hasRecords(tag) {
	const outPath = path.join(PLAYTEST_DIR, `${tag}.jsonl`);
	if (!existsSync(outPath)) return false;
	const text = await readFile(outPath, "utf8");
	return text.split(/\r?\n/).some((line) => line.trim() !== "");
}

function runChild(task, logPath, resume) {
	const scriptPath = path.join(ROOT, "scripts", "r2-legacy-forgetting.mjs");
	return new Promise((resolve, reject) => {
		const out = openSync(logPath, "w");
		const child = spawn(
			process.execPath,
			[
				scriptPath,
				"run",
				"--story-index",
				String(task.index),
				"--depth",
				String(task.depth),
				"--profile",
				task.profile,
				...["--resume", resume ? "true" : "false"],
			],
			{ stdio: ["ignore", out, out] },
		);
		child.on("exit", (code) => {
			closeSync(out);
			if (code === 0) resolve();
			else reject(new Error(`子进程失败（${code}）：${logPath}`));
		});
	});
}

async function finalizeRuns() {
	const { chats } = await legacyChats();
	const branches = JSON.parse(
		await readFile(path.join(WORK_DIR, "branches.json"), "utf8"),
	);
	let patched = 0;
	for (const [index] of chats.entries()) {
		const record = storyRecord(chats, index);
		for (const depth of BRANCH_DEPTHS) {
			for (const profile of ["naive", "native"]) {
				const tag = `${index}-${depth}-${profile}`;
				const runPath = path.join(RUN_DIR, `${tag}.json`);
				const outPath = path.join(PLAYTEST_DIR, `${tag}.jsonl`);
				if (!existsSync(runPath) || !existsSync(outPath)) continue;
				const branch = branches[record.story]?.branches.find(
					(item) => item.target === depth,
				);
				if (branch === undefined) {
					throw new Error(`${record.story} 缺少深度 ${depth} 的分支点`);
				}
				const run = JSON.parse(await readFile(runPath, "utf8"));
				const records = (await readFile(outPath, "utf8"))
					.split(/\r?\n/)
					.filter((line) => line.trim() !== "")
					.map((line) => JSON.parse(line));
				run.headNodeId = branch.nodeId;
				run.startDepth = branch.depth;
				run.completedRounds = records.length;
				run.failedRounds = records.filter(
					(item) => item.status === "failed",
				).length;
				await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
				console.log(
					`${tag}：${run.completedRounds}/${run.rounds} 轮，失败 ${run.failedRounds}，起点 ${branch.nodeId}（深度 ${branch.depth}）`,
				);
				patched += 1;
			}
		}
	}
	console.log(`整理 ${patched} 份运行结果`);
}

function parseArgs(argv) {
	const [command, ...rest] = argv;
	const options = {};
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (!arg.startsWith("--")) throw new Error(`多余的参数 ${arg}`);
		options[arg.slice(2)] = rest[index + 1];
		index += 1;
	}
	return { command, options };
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === "import") await importStories();
else if (command === "branches") await showBranches();
else if (command === "run") await runOne(options);
else if (command === "run-all") await runAll(options);
else if (command === "finalize") await finalizeRuns();
else {
	throw new Error(
		"用法：node scripts/r2-legacy-forgetting.mjs import|branches|run --story-index <n> --depth <119|219> --profile <naive|native>",
	);
}
