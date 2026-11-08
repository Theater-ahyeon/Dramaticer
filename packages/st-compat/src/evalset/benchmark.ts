import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	type ContextTemplate,
	StoryStore,
	assertContextTemplate,
} from "@dramaticer/core";
import { parseCharacterCardJson } from "../character-card.js";
import { importChatFileToStore } from "../chat-import.js";
import { parseChatJsonlFile } from "../chat-jsonl.js";
import { importCardContent } from "../chat/session.js";
import {
	BENCHMARK_SEED,
	BENCHMARK_STORIES,
	BENCHMARK_TURNS,
	type BenchmarkBranchSpec,
	type BenchmarkStorySpec,
} from "./benchmark-data.js";
import {
	MEMORY_QUESTION_CATEGORIES,
	type MemoryQuestion,
	readMemoryQuestionFile,
} from "./memory-questions.js";

export const BENCHMARK_FORBIDDEN_PATTERNS: readonly {
	readonly pattern: RegExp;
	readonly reason: string;
}[] = [
	{ pattern: /eval-private/i, reason: "指向私有评测目录" },
	{ pattern: /SillyTavern|TauriTavern/i, reason: "指向本地 ST 数据目录" },
	{ pattern: /[A-Za-z]:\\/, reason: "包含 Windows 绝对路径" },
	{ pattern: /(^|[^a-z])\/tmp\//i, reason: "包含临时目录路径" },
	{ pattern: /\.env\b/i, reason: "引用环境变量文件" },
	{ pattern: /性交|色情|强奸|fuck|explicit sex/i, reason: "不是 SFW 文本" },
];

export interface BenchmarkProbeQuestion {
	readonly id: string;
	readonly story: string;
	readonly askAtNode: string;
	readonly question: string;
	readonly answer: string;
	readonly evidenceNodes: readonly string[];
	readonly kind: "probe";
}

export interface BenchmarkBranchPoint {
	readonly id: string;
	readonly story: string;
	readonly nodeId: string;
	readonly nextUserText: string;
	readonly label: string;
}

export interface BenchmarkManifestBranch extends BenchmarkBranchSpec {
	readonly story: string;
	readonly nodeId: string;
	readonly depth: number;
}

export interface BenchmarkManifestStory {
	readonly storyId: string;
	readonly slug: string;
	readonly title: string;
	readonly card: string;
	readonly chat: string;
	readonly template: string;
	readonly memoryQuestions: string;
	readonly probeQuestions: string;
	readonly messages: number;
	readonly assistantFloors: number;
	readonly memoryQuestionCount: number;
	readonly probeQuestionCount: number;
	readonly branchPoints: readonly BenchmarkManifestBranch[];
}

export interface BenchmarkManifest {
	readonly version: 1;
	readonly seed: number;
	readonly turns: number;
	readonly stories: readonly BenchmarkManifestStory[];
	readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

export interface BenchmarkValidationResult {
	readonly stories: number;
	readonly messages: number;
	readonly memoryQuestions: number;
	readonly probeQuestions: number;
	readonly branchPoints: number;
}

export interface BenchmarkValidateOptions {
	/** 校验时导入基准用的临时目录；默认写到 `.devloop/scratch`。 */
	readonly scratchDir?: string;
}

export interface BenchmarkImportOptions {
	readonly rootDir: string;
	readonly storyIds?: readonly string[];
}

export interface BenchmarkImportResult {
	readonly stories: readonly {
		readonly storyId: string;
		readonly title: string;
		readonly nodeCount: number;
	}[];
}

export function benchmarkNodeId(storyId: string, turn: number): string {
	return `${storyId}:m${2 * (turn - 1)}:s0`;
}

export function benchmarkMemoryFileName(slug: string): string {
	return `memory-${slug}.jsonl`;
}

export function benchmarkProbeFileName(slug: string): string {
	return `probe-${slug}.jsonl`;
}

export async function readProbeQuestionFile(
	filePath: string,
): Promise<BenchmarkProbeQuestion[]> {
	return parseProbeQuestions(await readFile(filePath, "utf8"), filePath);
}

export function benchmarkStoryById(storyId: string): BenchmarkStorySpec {
	const spec = BENCHMARK_STORIES.find((story) => story.storyId === storyId);
	if (spec === undefined) {
		throw new Error(`基准里没有故事 ${storyId}`);
	}
	return spec;
}

/** 生成全部基准文件的相对路径与内容；同一版本重复调用逐字节相同。 */
export function buildBenchmarkFiles(): Map<string, string> {
	const files = new Map<string, string>();
	const manifestStories: BenchmarkManifestStory[] = [];
	for (const spec of BENCHMARK_STORIES) {
		const cardPath = `cards/${spec.slug}.json`;
		const chatPath = `chats/${spec.slug}.jsonl`;
		const templatePath = `templates/${spec.slug}.json`;
		const memoryPath = `questions/${benchmarkMemoryFileName(spec.slug)}`;
		const probePath = `questions/${benchmarkProbeFileName(spec.slug)}`;
		files.set(cardPath, renderCard(spec));
		files.set(chatPath, renderChat(spec));
		files.set(templatePath, renderTemplate(spec));
		files.set(memoryPath, renderMemoryQuestions(spec));
		files.set(probePath, renderProbeQuestions(spec));
		manifestStories.push({
			storyId: spec.storyId,
			slug: spec.slug,
			title: spec.title,
			card: cardPath,
			chat: chatPath,
			template: templatePath,
			memoryQuestions: memoryPath,
			probeQuestions: probePath,
			messages: BENCHMARK_TURNS * 2,
			assistantFloors: BENCHMARK_TURNS,
			memoryQuestionCount: spec.memory.length,
			probeQuestionCount: spec.probes.length,
			branchPoints: spec.branches.map((branch) => ({
				...branch,
				story: spec.storyId,
				nodeId: benchmarkNodeId(spec.storyId, branch.turn),
				depth: 2 * branch.turn - 1,
			})),
		});
	}
	files.set("branch-points.jsonl", renderBranchPoints());
	const filesWithHash = [...files.entries()]
		.map(([relativePath, content]) => ({
			path: relativePath,
			sha256: createHash("sha256").update(content, "utf8").digest("hex"),
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
	const manifest: BenchmarkManifest = {
		version: 1,
		seed: BENCHMARK_SEED,
		turns: BENCHMARK_TURNS,
		stories: manifestStories,
		files: filesWithHash,
	};
	files.set("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);
	return files;
}

export async function writeBenchmark(
	rootDir: string,
): Promise<BenchmarkManifest> {
	if (existsSync(rootDir) && !existsSync(path.join(rootDir, "manifest.json"))) {
		const entries = readdirSync(rootDir);
		if (entries.length > 0) {
			throw new Error(
				`${rootDir} 不是基准目录；只能写入空目录或已存在的基准目录`,
			);
		}
	}
	const files = buildBenchmarkFiles();
	for (const [relativePath, content] of files) {
		const target = path.join(rootDir, relativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
	return JSON.parse(files.get("manifest.json") ?? "") as BenchmarkManifest;
}

export async function validateBenchmark(
	rootDir: string,
	options: BenchmarkValidateOptions = {},
): Promise<BenchmarkValidationResult> {
	const expected = buildBenchmarkFiles();
	const actual = await readBenchmarkFiles(rootDir);
	for (const [relativePath, content] of expected) {
		const onDisk = actual.get(relativePath);
		if (onDisk === undefined) {
			throw new Error(`基准缺少文件：${relativePath}`);
		}
		if (onDisk !== content) {
			throw new Error(
				`基准文件 ${relativePath} 与生成结果不一致；重新运行 benchmark --generate`,
			);
		}
	}
	for (const relativePath of actual.keys()) {
		if (!expected.has(relativePath)) {
			throw new Error(`基准里有多余文件：${relativePath}`);
		}
	}
	return validateBenchmarkContent(rootDir, actual, options);
}

/** 只做结构与证据校验，不比对生成结果；改动手写基准时用它定位问题。 */
export async function validateBenchmarkStructure(
	rootDir: string,
	options: BenchmarkValidateOptions = {},
): Promise<BenchmarkValidationResult> {
	return validateBenchmarkContent(
		rootDir,
		await readBenchmarkFiles(rootDir),
		options,
	);
}

async function validateBenchmarkContent(
	rootDir: string,
	actual: ReadonlyMap<string, string>,
	options: BenchmarkValidateOptions,
): Promise<BenchmarkValidationResult> {
	for (const [relativePath, content] of actual) {
		assertPublicBenchmarkText(relativePath, content);
	}

	const manifest = parseManifest(actual.get("manifest.json") ?? "");
	const branchPoints = parseBranchPoints(
		actual.get("branch-points.jsonl") ?? "",
	);
	const seenQuestionIds = new Set<string>();
	let memoryTotal = 0;
	let probeTotal = 0;
	for (const story of manifest.stories) {
		const spec = benchmarkStoryById(story.storyId);
		const card = parseCharacterCardJson(actual.get(story.card) ?? "");
		if (card.name !== spec.card.name) {
			throw new Error(
				`${story.card} 的角色名是 ${card.name}，期望 ${spec.card.name}`,
			);
		}
		if (card.characterBook === null) {
			throw new Error(`${story.card} 缺少世界书`);
		}
		const template = parseTemplate(actual.get(story.template) ?? "");
		assertContextTemplate(template);
		if (template.segments.at(-1)?.id !== "protocol") {
			throw new Error(`${story.template} 的 protocol 段必须是最后一个段落`);
		}

		const entries = [];
		for await (const entry of parseChatJsonlFile(
			path.join(rootDir, story.chat),
		)) {
			entries.push(entry);
		}
		const messages = entries.filter((entry) => entry.kind === "message");
		if (messages.length !== BENCHMARK_TURNS * 2) {
			throw new Error(
				`${story.chat} 有 ${messages.length} 条消息，期望 ${BENCHMARK_TURNS * 2}`,
			);
		}
		for (const [index, entry] of messages.entries()) {
			if (entry.kind !== "message") continue;
			const expectedUser = index % 2 === 1;
			if (entry.message.isUser !== expectedUser) {
				throw new Error(`${story.chat} 第 ${index} 条消息的发言者顺序不对`);
			}
			if (entry.message.text.trim().length === 0) {
				throw new Error(`${story.chat} 第 ${index} 条消息正文为空`);
			}
		}

		const memoryQuestions = await readMemoryQuestionFile(
			path.join(rootDir, story.memoryQuestions),
		);
		checkQuestions(story.storyId, memoryQuestions, seenQuestionIds);
		const categories = new Set(
			memoryQuestions.map((question) => question.category),
		);
		for (const category of MEMORY_QUESTION_CATEGORIES) {
			if (!categories.has(category)) {
				throw new Error(`${story.memoryQuestions} 缺少 ${category} 类的记忆题`);
			}
		}
		if (!memoryQuestions.some((question) => question.fabricated)) {
			throw new Error(`${story.memoryQuestions} 没有编造回忆题`);
		}
		memoryTotal += memoryQuestions.length;

		const probeQuestions = parseProbeQuestions(
			actual.get(story.probeQuestions) ?? "",
			story.probeQuestions,
		);
		checkProbeQuestions(story.storyId, probeQuestions, seenQuestionIds);
		probeTotal += probeQuestions.length;

		const storyBranches = branchPoints.filter(
			(branch) => branch.story === story.storyId,
		);
		if (storyBranches.length !== story.branchPoints.length) {
			throw new Error(`${story.storyId} 的分支点数量与 manifest 不一致`);
		}
	}

	await verifyAgainstStore(rootDir, manifest, branchPoints, options);
	return {
		stories: manifest.stories.length,
		messages: manifest.stories.reduce(
			(total, story) => total + story.messages,
			0,
		),
		memoryQuestions: memoryTotal,
		probeQuestions: probeTotal,
		branchPoints: branchPoints.length,
	};
}

export async function importBenchmark(
	store: StoryStore,
	options: BenchmarkImportOptions,
): Promise<BenchmarkImportResult> {
	const manifest = parseManifest(
		await readFile(path.join(options.rootDir, "manifest.json"), "utf8"),
	);
	const selected =
		options.storyIds === undefined
			? manifest.stories
			: manifest.stories.filter((story) =>
					options.storyIds?.includes(story.storyId),
				);
	if (selected.length === 0) {
		throw new Error("没有找到要导入的基准故事");
	}
	const imported: {
		readonly storyId: string;
		readonly title: string;
		readonly nodeCount: number;
	}[] = [];
	for (const story of selected) {
		const spec = benchmarkStoryById(story.storyId);
		const card = parseCharacterCardJson(
			await readFile(path.join(options.rootDir, story.card), "utf8"),
		);
		const result = await importChatFileToStore(
			store,
			path.join(options.rootDir, story.chat),
			{ storyId: story.storyId, title: spec.title },
		);
		const content = importCardContent(store, story.storyId, { card });
		const template = parseTemplate(
			await readFile(path.join(options.rootDir, story.template), "utf8"),
		);
		const saved = store.createContextTemplate({
			name: `${spec.title} 原生模板`,
			template,
		});
		store.updateStorySettings(story.storyId, {
			cardName: content.cardName,
			characterPrompt: content.characterPrompt,
			persona: spec.persona,
			templateId: saved.id,
		});
		imported.push({
			storyId: story.storyId,
			title: spec.title,
			nodeCount: result.nodeCount,
		});
	}
	return { stories: imported };
}

export function parseProbeQuestions(
	text: string,
	label: string,
): BenchmarkProbeQuestion[] {
	const questions: BenchmarkProbeQuestion[] = [];
	const seen = new Map<string, number>();
	const lines = text.split(/\r?\n/);
	lines.forEach((line, index) => {
		if (line.trim() === "") return;
		const lineLabel = `${label}:${index + 1}`;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`${lineLabel} 不是合法的 JSON`);
		}
		const question = parseProbeQuestion(value, lineLabel);
		const first = seen.get(question.id);
		if (first !== undefined) {
			throw new Error(`${lineLabel} 的 id ${question.id} 与第 ${first} 行重复`);
		}
		seen.set(question.id, index + 1);
		questions.push(question);
	});
	if (questions.length === 0) {
		throw new Error(`${label} 没有任何探针题`);
	}
	return questions;
}

function parseProbeQuestion(
	value: unknown,
	label: string,
): BenchmarkProbeQuestion {
	if (!isPlainObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const allowed = [
		"id",
		"story",
		"askAtNode",
		"question",
		"answer",
		"evidenceNodes",
		"kind",
	];
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			throw new Error(`${label} 有未知字段 ${key}`);
		}
	}
	const kind = requireText(value.kind, `${label} 的 kind`);
	if (kind !== "probe") {
		throw new Error(`${label} 的 kind 是 ${kind}，期望 probe`);
	}
	const evidenceNodes = readNodeList(
		value.evidenceNodes,
		`${label} 的 evidenceNodes`,
	);
	return {
		id: requireText(value.id, `${label} 的 id`),
		story: requireText(value.story, `${label} 的 story`),
		askAtNode: requireText(value.askAtNode, `${label} 的 askAtNode`),
		question: requireText(value.question, `${label} 的 question`),
		answer: requireText(value.answer, `${label} 的 answer`),
		evidenceNodes,
		kind: "probe",
	};
}

export function parseBranchPoints(text: string): BenchmarkBranchPoint[] {
	const points: BenchmarkBranchPoint[] = [];
	const seen = new Map<string, number>();
	const lines = text.split(/\r?\n/);
	lines.forEach((line, index) => {
		if (line.trim() === "") return;
		const label = `branch-points.jsonl:${index + 1}`;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`${label} 不是合法的 JSON`);
		}
		const point = parseBranchPoint(value, label);
		const first = seen.get(point.id);
		if (first !== undefined) {
			throw new Error(`${label} 的 id ${point.id} 与第 ${first} 行重复`);
		}
		seen.set(point.id, index + 1);
		points.push(point);
	});
	if (points.length === 0) {
		throw new Error("branch-points.jsonl 没有任何分支点");
	}
	return points;
}

function parseBranchPoint(value: unknown, label: string): BenchmarkBranchPoint {
	if (!isPlainObject(value)) {
		throw new Error(`${label} 必须是对象`);
	}
	const allowed = ["id", "story", "nodeId", "nextUserText", "label"];
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			throw new Error(`${label} 有未知字段 ${key}`);
		}
	}
	return {
		id: requireText(value.id, `${label} 的 id`),
		story: requireText(value.story, `${label} 的 story`),
		nodeId: requireText(value.nodeId, `${label} 的 nodeId`),
		nextUserText: requireText(value.nextUserText, `${label} 的 nextUserText`),
		label: requireText(value.label, `${label} 的 label`),
	};
}

async function verifyAgainstStore(
	rootDir: string,
	manifest: BenchmarkManifest,
	branchPoints: readonly BenchmarkBranchPoint[],
	options: BenchmarkValidateOptions,
): Promise<void> {
	const scratchRoot = options.scratchDir ?? path.resolve(".devloop/scratch");
	await mkdir(scratchRoot, { recursive: true });
	const dir = mkdtempSync(path.join(scratchRoot, "benchmark-"));
	const store = StoryStore.open(path.join(dir, "benchmark.db"));
	try {
		const imported = await importBenchmark(store, { rootDir });
		if (imported.stories.length !== manifest.stories.length) {
			throw new Error("导入的故事数量与 manifest 不一致");
		}
		for (const story of manifest.stories) {
			const onPath = store.getPathToHead(story.storyId);
			if (onPath.length !== story.messages) {
				throw new Error(
					`${story.storyId} 的主路径有 ${onPath.length} 个楼层，期望 ${story.messages}`,
				);
			}
			const pathIds = new Set(onPath.map((node) => node.id));
			for (const node of onPath) {
				if (node.raw.trim().length === 0) {
					throw new Error(`${story.storyId} 的楼层 ${node.id} 原文为空`);
				}
			}
			const memoryQuestions = await readMemoryQuestionFile(
				path.join(rootDir, story.memoryQuestions),
			);
			for (const question of memoryQuestions) {
				checkNodeReferences(question, pathIds, story.storyId);
			}
			const probeQuestions = parseProbeQuestions(
				await readFile(path.join(rootDir, story.probeQuestions), "utf8"),
				story.probeQuestions,
			);
			for (const question of probeQuestions) {
				checkNodeReferences(
					{
						id: question.id,
						askAtNode: question.askAtNode,
						evidenceNodes: question.evidenceNodes,
					},
					pathIds,
					story.storyId,
				);
			}
			const settings = store.getStorySettings(story.storyId);
			if (
				settings.characterPrompt === null ||
				settings.characterPrompt.trim().length === 0
			) {
				throw new Error(`${story.storyId} 导入后没有角色提示词`);
			}
			if (settings.templateId === null) {
				throw new Error(`${story.storyId} 导入后没有绑定原生模板`);
			}
		}
		const perStory = new Map<string, number[]>();
		const seenNodes = new Set<string>();
		for (const branch of branchPoints) {
			const story = manifest.stories.find(
				(candidate) => candidate.storyId === branch.story,
			);
			if (story === undefined) {
				throw new Error(`分支点 ${branch.id} 指向未知故事 ${branch.story}`);
			}
			const node = store.getNode(branch.nodeId);
			if (node === null || node.storyId !== branch.story) {
				throw new Error(`分支点 ${branch.id} 的楼层不存在：${branch.nodeId}`);
			}
			if (node.role !== "assistant") {
				throw new Error(`分支点 ${branch.id} 的楼层不是助手楼层`);
			}
			if (seenNodes.has(branch.nodeId)) {
				throw new Error(`分支点 ${branch.id} 与另一个分支点使用同一楼层`);
			}
			seenNodes.add(branch.nodeId);
			const depth = store
				.getPathToHead(branch.story)
				.findIndex((candidate) => candidate.id === branch.nodeId);
			if (depth < 0) {
				throw new Error(`分支点 ${branch.id} 的楼层不在当前路径上`);
			}
			const depths = perStory.get(branch.story) ?? [];
			depths.push(depth + 1);
			perStory.set(branch.story, depths);
		}
		for (const story of manifest.stories) {
			const depths = perStory.get(story.storyId) ?? [];
			if (depths.length < 3) {
				throw new Error(`${story.storyId} 的分支点少于 3 个`);
			}
			if (!depths.some((depth) => depth >= 100)) {
				throw new Error(`${story.storyId} 没有 100 楼以上的分支点`);
			}
			if (!depths.some((depth) => depth >= 200)) {
				throw new Error(`${story.storyId} 没有 200 楼以上的分支点`);
			}
		}
	} finally {
		store.close();
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}

function checkQuestions(
	storyId: string,
	questions: readonly MemoryQuestion[],
	seen: Set<string>,
): void {
	for (const question of questions) {
		if (question.story !== storyId) {
			throw new Error(
				`记忆题 ${question.id} 属于故事 ${question.story}，期望 ${storyId}`,
			);
		}
		if (seen.has(question.id)) {
			throw new Error(`题目 id 重复：${question.id}`);
		}
		seen.add(question.id);
	}
}

function checkProbeQuestions(
	storyId: string,
	questions: readonly BenchmarkProbeQuestion[],
	seen: Set<string>,
): void {
	for (const question of questions) {
		if (question.story !== storyId) {
			throw new Error(
				`探针题 ${question.id} 属于故事 ${question.story}，期望 ${storyId}`,
			);
		}
		if (seen.has(question.id)) {
			throw new Error(`题目 id 重复：${question.id}`);
		}
		seen.add(question.id);
	}
}

function checkNodeReferences(
	question: {
		readonly id: string;
		readonly askAtNode: string;
		readonly evidenceNodes: readonly string[];
	},
	pathIds: ReadonlySet<string>,
	storyId: string,
): void {
	if (!pathIds.has(question.askAtNode)) {
		throw new Error(
			`题目 ${question.id} 的提问楼层不在 ${storyId} 的主路径上：${question.askAtNode}`,
		);
	}
	for (const evidence of question.evidenceNodes) {
		if (!pathIds.has(evidence)) {
			throw new Error(
				`题目 ${question.id} 的证据楼层不在 ${storyId} 的主路径上：${evidence}`,
			);
		}
	}
	if (nodeTurn(question.askAtNode, storyId) <= maxEvidenceTurn(question)) {
		throw new Error(`题目 ${question.id} 的提问楼层不晚于证据楼层`);
	}
}

function nodeTurn(nodeId: string, storyId: string): number {
	const prefix = `${storyId}:m`;
	if (!nodeId.startsWith(prefix)) {
		throw new Error(`楼层 id ${nodeId} 不属于故事 ${storyId}`);
	}
	const rest = nodeId.slice(prefix.length);
	const match = /^(\d+):s(\d+)$/.exec(rest);
	if (match === null) {
		throw new Error(`楼层 id 格式不对：${nodeId}`);
	}
	const index = Number(match[1]);
	if (index % 2 !== 0) {
		throw new Error(`楼层 id ${nodeId} 不是助手楼层`);
	}
	return index / 2 + 1;
}

function maxEvidenceTurn(question: {
	readonly evidenceNodes: readonly string[];
}): number {
	let max = 0;
	for (const evidence of question.evidenceNodes) {
		const match = /:m(\d+):s\d+$/.exec(evidence);
		if (match === null) {
			throw new Error(`证据楼层 id 格式不对：${evidence}`);
		}
		max = Math.max(max, Number(match[1]) / 2 + 1);
	}
	return max;
}

function assertPublicBenchmarkText(
	relativePath: string,
	content: string,
): void {
	for (const { pattern, reason } of BENCHMARK_FORBIDDEN_PATTERNS) {
		if (pattern.test(content)) {
			throw new Error(`${relativePath} ${reason}：${pattern.source}`);
		}
	}
}

async function readBenchmarkFiles(
	rootDir: string,
): Promise<Map<string, string>> {
	if (!existsSync(rootDir)) {
		throw new Error(`基准目录不存在：${rootDir}`);
	}
	const files = new Map<string, string>();
	const walk = async (relativeDir: string): Promise<void> => {
		const entries = readdirSync(path.join(rootDir, relativeDir), {
			withFileTypes: true,
		});
		for (const entry of entries) {
			const relativePath =
				relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
			if (entry.isDirectory()) {
				await walk(relativePath);
				continue;
			}
			files.set(
				relativePath,
				(await readFile(path.join(rootDir, relativePath), "utf8")).replace(
					/\r\n/g,
					"\n",
				),
			);
		}
	};
	await walk("");
	return files;
}

function parseManifest(text: string): BenchmarkManifest {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("manifest.json 不是合法的 JSON");
	}
	if (!isPlainObject(value)) {
		throw new Error("manifest.json 必须是对象");
	}
	const stories = value.stories;
	if (!Array.isArray(stories)) {
		throw new Error("manifest.json 的 stories 必须是数组");
	}
	return value as unknown as BenchmarkManifest;
}

function parseTemplate(text: string): ContextTemplate {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("原生模板不是合法的 JSON");
	}
	return value as ContextTemplate;
}

function renderCard(spec: BenchmarkStorySpec): string {
	const card = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: spec.card.name,
			description: spec.card.description,
			personality: spec.card.personality,
			scenario: spec.card.scenario,
			first_mes: spec.card.firstMessage,
			mes_example: spec.card.messageExample,
			creator_notes: "Dramaticer 公开合成基准，不含真实人物或版权文本。",
			tags: ["synthetic", "benchmark", "sfw"],
			character_book: {
				name: `${spec.card.name}的世界书`,
				entries: spec.card.worldBook.map((entry, index) => ({
					id: index,
					keys: entry.keys,
					content: entry.content,
					enabled: true,
					constant: entry.constant,
					insertion_order: index,
				})),
			},
			extensions: {},
		},
	};
	return `${JSON.stringify(card, null, "\t")}\n`;
}

function renderChat(spec: BenchmarkStorySpec): string {
	const header = {
		user_name: "玩家",
		character_name: spec.card.name,
		chat_metadata: { source: "dramaticer-benchmark", seed: BENCHMARK_SEED },
	};
	const beatByTurn = new Map(spec.beats.map((beat) => [beat.turn, beat]));
	const base = Date.parse("2026-01-01T08:00:00.000Z");
	const lines = [JSON.stringify(header)];
	for (let turn = 1; turn <= BENCHMARK_TURNS; turn += 1) {
		const beat = beatByTurn.get(turn);
		const assistant = beat?.assistant ?? renderFillerAssistant(spec, turn);
		const user = beat?.user ?? pick(spec.filler.userLines, spec, turn, 3);
		lines.push(
			JSON.stringify({
				name: spec.card.name,
				is_user: false,
				send_date: new Date(base + (2 * turn - 2) * 60_000).toISOString(),
				mes: assistant,
			}),
		);
		lines.push(
			JSON.stringify({
				name: "玩家",
				is_user: true,
				send_date: new Date(base + (2 * turn - 1) * 60_000).toISOString(),
				mes: user,
			}),
		);
	}
	return `${lines.join("\n")}\n`;
}

function renderFillerAssistant(spec: BenchmarkStorySpec, turn: number): string {
	const place = pick(spec.filler.places, spec, turn, 1);
	const object = pick(spec.filler.objects, spec, turn, 2);
	const motion = pick(spec.filler.motions, spec, turn, 4);
	const detail = pick(spec.filler.details, spec, turn, 5);
	return `第 ${turn} 天，${place}的${object}${motion}。${detail}`;
}

function pick(
	values: readonly string[],
	spec: BenchmarkStorySpec,
	turn: number,
	salt: number,
): string {
	const index = hashIndex(`${spec.slug}:${turn}:${salt}`, values.length);
	const value = values[index];
	if (value === undefined) {
		throw new Error(`基准故事 ${spec.slug} 的填充文本为空`);
	}
	return value;
}

function hashIndex(key: string, length: number): number {
	let hash = 2166136261;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash % length;
}

function renderTemplate(spec: BenchmarkStorySpec): string {
	const template: ContextTemplate = {
		id: `${spec.storyId}-template`,
		segments: [
			{ id: "premise", kind: "static", text: spec.premise },
			{ id: "character", kind: "slot", slot: "character", priority: 100 },
			{ id: "lore", kind: "slot", slot: "lore" },
			{ id: "state", kind: "slot", slot: "state" },
			{ id: "history", kind: "slot", slot: "history" },
			{
				id: "protocol",
				kind: "static",
				text: "只描写本轮发生的事，保持人物口吻，不替玩家决定行动。",
			},
		],
	};
	return `${JSON.stringify(template, null, "\t")}\n`;
}

function renderMemoryQuestions(spec: BenchmarkStorySpec): string {
	const lines = spec.memory.map((question) =>
		JSON.stringify({
			id: question.id,
			story: spec.storyId,
			askAtNode: benchmarkNodeId(spec.storyId, question.askTurn),
			question: question.question,
			answer: question.answer,
			evidenceNodes: question.evidenceTurns.map((turn) =>
				benchmarkNodeId(spec.storyId, turn),
			),
			category: question.category,
			kind: "memory",
			fabricated: question.fabricated === true,
		}),
	);
	return `${lines.join("\n")}\n`;
}

function renderProbeQuestions(spec: BenchmarkStorySpec): string {
	const lines = spec.probes.map((question) =>
		JSON.stringify({
			id: question.id,
			story: spec.storyId,
			askAtNode: benchmarkNodeId(spec.storyId, question.askTurn),
			question: question.question,
			answer: question.answer,
			evidenceNodes: question.evidenceTurns.map((turn) =>
				benchmarkNodeId(spec.storyId, turn),
			),
			kind: "probe",
		}),
	);
	return `${lines.join("\n")}\n`;
}

function renderBranchPoints(): string {
	const points: BenchmarkBranchPoint[] = [];
	for (const spec of BENCHMARK_STORIES) {
		for (const branch of spec.branches) {
			points.push({
				id: branch.id,
				story: spec.storyId,
				nodeId: benchmarkNodeId(spec.storyId, branch.turn),
				nextUserText: branch.nextUserText,
				label: branch.label,
			});
		}
	}
	return `${points.map((point) => JSON.stringify(point)).join("\n")}\n`;
}

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} 必须是非空字符串`);
	}
	return value;
}

function readNodeList(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} 必须是非空数组`);
	}
	const nodes = value.map((node, index) =>
		requireText(node, `${label}[${index}]`),
	);
	const duplicated = nodes.find((node, index) => nodes.indexOf(node) !== index);
	if (duplicated !== undefined) {
		throw new Error(`${label} 重复了楼层 ${duplicated}`);
	}
	return nodes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
