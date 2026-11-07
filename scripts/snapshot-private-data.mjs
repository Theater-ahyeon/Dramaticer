import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import extractChunks from "png-chunks-extract";
import pngText from "png-chunk-text";

const DEFAULT_ST_ROOT = "D:\\SillyTavern\\TauriTavern\\default-user";
const stRoot = path.resolve(process.env.DRAMATICER_ST_ROOT ?? DEFAULT_ST_ROOT);
const outRoot = path.resolve("eval-private", "raw");

const chatSpecs = [
	{ label: "仙侠雌竞", matches: (name) => name.startsWith("仙侠雌竞") },
	{ label: "银麒赎世", matches: (name) => name === "银麒赎世" },
	{ label: "欲望世界-1600", matches: (name) => name === "欲望世界-1600" },
];

function relativeToRoot(absolutePath) {
	return path.relative(stRoot, absolutePath).split(path.sep).join("/");
}

async function findChatDir(spec) {
	const entries = await readdir(path.join(stRoot, "chats"), { withFileTypes: true });
	const candidates = entries.filter((entry) => entry.isDirectory() && spec.matches(entry.name));
	if (candidates.length === 0) {
		throw new Error(`找不到对话目录：${spec.label}`);
	}
	if (candidates.length > 1) {
		throw new Error(
			`对话目录不唯一：${spec.label} → ${candidates.map((entry) => entry.name).join("、")}`,
		);
	}
	return candidates[0].name;
}

async function findLargestChatFile(chatDir) {
	const dir = path.join(stRoot, "chats", chatDir);
	const files = (await readdir(dir, { withFileTypes: true })).filter(
		(entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl"),
	);
	if (files.length === 0) {
		throw new Error(`对话目录里没有 jsonl 文件：${chatDir}`);
	}
	const sized = await Promise.all(
		files.map(async (entry) => ({
			name: entry.name,
			size: (await stat(path.join(dir, entry.name))).size,
		})),
	);
	sized.sort((a, b) => b.size - a.size);
	return sized[0];
}

async function findCardFile(character) {
	const entries = (await readdir(path.join(stRoot, "characters"), { withFileTypes: true })).filter(
		(entry) => entry.isFile() && /\.(png|json)$/i.test(entry.name),
	);
	const exact = entries.find((entry) => entry.name === `${character}.png`);
	if (exact) return exact.name;
	const exactJson = entries.find((entry) => entry.name === `${character}.json`);
	if (exactJson) return exactJson.name;

	const fuzzy = entries.filter((entry) => {
		const stem = entry.name.replace(/\.(png|json)$/i, "");
		return stem === character;
	});
	if (fuzzy.length === 1) return fuzzy[0].name;
	throw new Error(`找不到角色卡：${character}`);
}

function collectWorldRefs(card) {
	const data = card && typeof card.data === "object" ? card.data : card;
	const refs = [];
	const world = data?.extensions?.world;
	if (typeof world === "string" && world.trim()) refs.push(world.trim());
	const bookName = data?.character_book?.name;
	if (typeof bookName === "string" && bookName.trim()) refs.push(bookName.trim());
	return [...new Set(refs)];
}

async function readCard(cardFile) {
	const fullPath = path.join(stRoot, "characters", cardFile);
	if (cardFile.toLowerCase().endsWith(".json")) {
		return JSON.parse(await readFile(fullPath, "utf8"));
	}

	const chunks = extractChunks(new Uint8Array(await readFile(fullPath)));
	const texts = chunks
		.filter((chunk) => chunk.name === "tEXt")
		.map((chunk) => pngText.decode(chunk));
	for (const keyword of ["ccv3", "chara"]) {
		const found = texts.find((text) => text.keyword === keyword);
		if (found) {
			return JSON.parse(Buffer.from(found.text, "base64").toString("utf8"));
		}
	}
	throw new Error(`PNG 里找不到 chara 或 ccv3 文本块：${cardFile}`);
}

async function findWorldFile(refs, character) {
	if (refs.length === 0) {
		throw new Error(`角色卡没有记录世界书引用：${character}`);
	}
	const entries = (
		await readdir(path.join(stRoot, "worlds"), { withFileTypes: true })
	).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"));
	const byStem = new Map(
		entries.map((entry) => [entry.name.slice(0, -".json".length).toLowerCase(), entry.name]),
	);
	for (const ref of refs) {
		const exact = byStem.get(ref.replace(/\.json$/i, "").toLowerCase());
		if (exact) return exact;
	}
	for (const ref of refs) {
		const normalized = ref.replace(/\.json$/i, "").toLowerCase();
		const fuzzy = entries.filter((entry) => {
			const stem = entry.name.slice(0, -".json".length).toLowerCase();
			return stem.startsWith(normalized) || normalized.startsWith(stem);
		});
		if (fuzzy.length === 1) return fuzzy[0].name;
	}
	throw new Error(
		`找不到世界书文件：${character}，引用了 ${refs.join("、")}`,
	);
}

async function walkFiles(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkFiles(fullPath)));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

async function copyWithHash(source, target) {
	await mkdir(path.dirname(target), { recursive: true });
	const hash = createHash("sha256");
	let size = 0;
	const sourceStream = createReadStream(source);
	sourceStream.on("data", (chunk) => {
		hash.update(chunk);
		size += chunk.length;
	});
	await pipeline(sourceStream, createWriteStream(target));
	return { size, sha256: hash.digest("hex") };
}

async function main() {
	if (outRoot === stRoot || outRoot.startsWith(`${stRoot}${path.sep}`)) {
		throw new Error(`输出目录不能位于源目录内部：${outRoot}`);
	}

	const plan = new Map();
	const add = (entry) => {
		if (!plan.has(entry.source)) plan.set(entry.source, entry);
	};

	for (const spec of chatSpecs) {
		const chatDir = await findChatDir(spec);
		const chatFile = await findLargestChatFile(chatDir);
		add({
			role: "chat",
			character: chatDir,
			source: relativeToRoot(path.join(stRoot, "chats", chatDir, chatFile.name)),
			target: path.join("chats", chatDir, chatFile.name),
		});

		const cardFile = await findCardFile(chatDir);
		const cardPath = path.join(stRoot, "characters", cardFile);
		add({
			role: "card",
			character: chatDir,
			source: relativeToRoot(cardPath),
			target: path.join("cards", cardFile),
		});

		const card = await readCard(cardFile);
		const worldFile = await findWorldFile(collectWorldRefs(card), chatDir);
		const worldPath = path.join(stRoot, "worlds", worldFile);
		add({
			role: "worldbook",
			character: chatDir,
			source: relativeToRoot(worldPath),
			target: path.join("worlds", worldFile),
		});
	}

	const presetDir = path.join(stRoot, "OpenAI Settings");
	for (const presetPath of await walkFiles(presetDir)) {
		add({
			role: "preset",
			source: relativeToRoot(presetPath),
			target: path.join("presets", path.relative(presetDir, presetPath)),
		});
	}

	const manifestFiles = [];
	for (const entry of plan.values()) {
		const source = path.resolve(stRoot, entry.source);
		const target = path.resolve(outRoot, entry.target);
		if (!target.startsWith(`${outRoot}${path.sep}`)) {
			throw new Error(`输出路径越界：${entry.target}`);
		}
		const { size, sha256 } = await copyWithHash(source, target);
		manifestFiles.push({
			role: entry.role,
			...(entry.character ? { character: entry.character } : {}),
			source: entry.source,
			target: entry.target.split(path.sep).join("/"),
			size,
			sha256,
		});
	}

	manifestFiles.sort((a, b) => a.target.localeCompare(b.target));
	const manifest = {
		generatedAt: new Date().toISOString(),
		stRoot,
		files: manifestFiles,
	};
	await writeFile(
		path.join(outRoot, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf8",
	);

	const totalBytes = manifestFiles.reduce((sum, file) => sum + file.size, 0);
	const counts = new Map();
	for (const file of manifestFiles) {
		counts.set(file.role, (counts.get(file.role) ?? 0) + 1);
	}
	console.log(`源目录：${stRoot}`);
	console.log(`输出目录：${outRoot}`);
	console.log(
		`复制 ${manifestFiles.length} 个文件，共 ${(totalBytes / 1024 / 1024).toFixed(2)} MB（${[...counts].map(([role, count]) => `${role} ${count}`).join("，")}）`,
	);
	console.log(`清单：${path.join(outRoot, "manifest.json")}`);
}

await main();
