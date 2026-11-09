import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../env.js";
import {
	type LlmChannelsConfig,
	loadChannelsConfig,
	resolveModelForRole,
} from "../llm/channels.js";
import { createLlmClient } from "../llm/configure.js";
import type { LlmClient } from "../llm/types.js";
import { StoryStore } from "../store/story-store.js";
import { type ImagesConfig, loadImagesConfig } from "./config.js";
import {
	VISUAL_PROFILE_JOB_KIND,
	createVisualProfileHandler,
} from "./profiles.js";
import {
	COMFYUI_SLOT_NAMES,
	type ComfyUiSlotDetection,
	type ComfyUiSlots,
	assertComfyUiSlots,
	detectComfyUiSlots,
	parseComfyUiWorkflow,
} from "./slots.js";
import type {
	CharacterVisualProfileRecord,
	ImageWorkflowRecord,
} from "./types.js";
import { resolveImageProvider } from "./workflows.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE =
	"用法：dramaticer images workflow import --file <路径> --name <名称> [--db <路径>] [--images <路径>] [--slots <json>] | list [--db <路径>] | show <id> [--db <路径>] | delete <id> [--db <路径>]；dramaticer images profiles --story <id> --db <路径> [--json] [--generate]";

type ImagesAction = "import" | "list" | "show" | "delete" | "profiles";

export interface ImagesCliDependencies {
	readonly log?: (message: string) => void;
	readonly envPath?: string;
	readonly channelsPath?: string;
	readonly loadEnv?: (path: string) => void;
	readonly loadConfig?: (path: string) => Promise<ImagesConfig>;
	readonly loadChannelsConfig?: (path: string) => Promise<LlmChannelsConfig>;
	readonly createClient?: (config: LlmChannelsConfig) => LlmClient;
}

export interface ImagesCliResult {
	readonly action: ImagesAction;
	readonly workflows: readonly ImageWorkflowRecord[];
	readonly profiles: readonly CharacterVisualProfileRecord[];
}

type ImagesArgs =
	| {
			readonly action: "import";
			readonly dbPath: string;
			readonly imagesPath: string;
			readonly file: string;
			readonly name: string;
			readonly slots: unknown;
	  }
	| { readonly action: "list"; readonly dbPath: string }
	| { readonly action: "show"; readonly dbPath: string; readonly id: string }
	| { readonly action: "delete"; readonly dbPath: string; readonly id: string }
	| {
			readonly action: "profiles";
			readonly dbPath: string;
			readonly storyId: string;
			readonly json: boolean;
			readonly generate: boolean;
	  };

/**
 * `dramaticer images`：workflow 的导入、列出、查看与删除，以及故事的角色
 * 视觉档案列表与同步重新生成。
 */
export async function runImagesCli(
	args: readonly string[],
	dependencies: ImagesCliDependencies = {},
): Promise<ImagesCliResult> {
	const parsed = parseImagesArgs(args);
	const log = dependencies.log ?? console.log;
	if (!existsSync(parsed.dbPath)) {
		throw new Error(`数据库不存在：${parsed.dbPath}`);
	}
	const store = StoryStore.open(parsed.dbPath);
	try {
		if (parsed.action === "profiles") {
			return await runProfiles(parsed, store, dependencies, log);
		}
		if (parsed.action === "list") {
			const workflows = store.listImageWorkflows();
			logWorkflows(workflows, log);
			return { action: "list", workflows, profiles: [] };
		}
		if (parsed.action === "show") {
			const workflow = requireWorkflow(store, parsed.id);
			log(JSON.stringify(workflow, null, 2));
			return { action: "show", workflows: [workflow], profiles: [] };
		}
		if (parsed.action === "delete") {
			const workflow = requireWorkflow(store, parsed.id);
			store.deleteImageWorkflow(parsed.id);
			log(`已删除 workflow ${workflow.id}（${workflow.name}）`);
			return { action: "delete", workflows: [workflow], profiles: [] };
		}
		return await importWorkflow(parsed, store, dependencies, log);
	} finally {
		store.close();
	}
}

async function runProfiles(
	parsed: Extract<ImagesArgs, { readonly action: "profiles" }>,
	store: StoryStore,
	dependencies: ImagesCliDependencies,
	log: (message: string) => void,
): Promise<ImagesCliResult> {
	if (parsed.generate) {
		const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
		const channelsPath =
			dependencies.channelsPath ?? path.join(repoRoot, "data", "channels.yaml");
		(dependencies.loadEnv ?? loadDotEnv)(envPath);
		const config = await (
			dependencies.loadChannelsConfig ?? loadChannelsConfig
		)(channelsPath);
		const model = resolveModelForRole(config, "settler");
		const client = (
			dependencies.createClient ??
			((value: LlmChannelsConfig) =>
				createLlmClient(value, { defaultModel: model, cacheDir: null }))
		)(config);
		const timestamp = new Date().toISOString();
		await createVisualProfileHandler()({
			store,
			client,
			job: {
				id: 0,
				storyId: parsed.storyId,
				nodeId: null,
				kind: VISUAL_PROFILE_JOB_KIND,
				status: "running",
				attempts: 1,
				lastError: null,
				createdAt: timestamp,
				startedAt: timestamp,
				finishedAt: null,
			},
		});
	}
	const profiles = store.listCharacterVisualProfiles(parsed.storyId);
	if (parsed.json) {
		log(JSON.stringify(profiles, null, 2));
	} else {
		logProfiles(profiles, log);
	}
	return { action: "profiles", workflows: [], profiles };
}

async function importWorkflow(
	parsed: Extract<ImagesArgs, { readonly action: "import" }>,
	store: StoryStore,
	dependencies: ImagesCliDependencies,
	log: (message: string) => void,
): Promise<ImagesCliResult> {
	const envPath = dependencies.envPath ?? path.join(repoRoot, ".env");
	if (existsSync(envPath)) (dependencies.loadEnv ?? loadDotEnv)(envPath);
	const config = await (dependencies.loadConfig ?? loadImagesConfig)(
		parsed.imagesPath,
	);
	const raw = await readWorkflowFile(parsed.file);
	const workflow = parseComfyUiWorkflow(raw, "workflow");
	const provider = resolveImageProvider(config);
	const detection = detectComfyUiSlots(workflow);
	logDetection(detection, log);
	let slots: ComfyUiSlots;
	if (parsed.slots !== undefined) {
		slots = assertComfyUiSlots(workflow, parsed.slots);
		log(`使用显式插槽：${formatSlots(slots)}`);
	} else if (detection.slots !== null) {
		slots = detection.slots;
		log(`自动采用插槽：${formatSlots(slots)}`);
	} else {
		const reasons =
			detection.unresolved.length === 0
				? "没有唯一的插槽候选"
				: `无法确定 ${detection.unresolved.join("、")}`;
		throw new Error(`slots 无法自动解析：${reasons}；请用 --slots 显式指定`);
	}
	const saved = store.saveImageWorkflow({
		name: parsed.name,
		provider: provider.id,
		payload: workflow,
		slots,
	});
	log(
		`已保存 workflow ${saved.id}（${saved.name}，provider ${saved.provider}）`,
	);
	return { action: "import", workflows: [saved], profiles: [] };
}

function logProfiles(
	profiles: readonly CharacterVisualProfileRecord[],
	log: (message: string) => void,
): void {
	if (profiles.length === 0) {
		log("还没有视觉档案。");
		return;
	}
	for (const record of profiles) {
		const profile = record.profile;
		log(
			`${profile.character}（来源 ${record.source}，更新于 ${record.updatedAt}）：${profile.base.join("、")}；默认服装：${profile.defaultOutfit}${profile.outfitPath === null ? "" : `；服装路径：${profile.outfitPath.join(".")}`}`,
		);
	}
}

async function readWorkflowFile(file: string): Promise<unknown> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		throw new Error(
			`读取 workflow 文件失败：${file}：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`workflow 文件不是合法 JSON：${file}`);
	}
}

function logDetection(
	detection: ComfyUiSlotDetection,
	log: (message: string) => void,
): void {
	log("插槽识别结果：");
	for (const name of COMFYUI_SLOT_NAMES) {
		const refs = detection.candidates[name];
		log(
			`  ${name}：${refs.length === 0 ? "没有候选" : refs.map((ref) => `${ref.nodeId}.${ref.input}`).join("、")}`,
		);
	}
	if (detection.unresolved.length > 0) {
		log(`  需要显式确认：${detection.unresolved.join("、")}`);
	}
}

function logWorkflows(
	workflows: readonly ImageWorkflowRecord[],
	log: (message: string) => void,
): void {
	if (workflows.length === 0) {
		log("还没有导入 workflow。");
		return;
	}
	for (const workflow of workflows) {
		log(
			`${workflow.id} ${workflow.name}（provider ${workflow.provider}，更新时间 ${workflow.updatedAt}）`,
		);
	}
}

function requireWorkflow(store: StoryStore, id: string): ImageWorkflowRecord {
	const workflow = store.getImageWorkflow(id);
	if (workflow === null) throw new Error(`workflow 不存在：${id}`);
	return workflow;
}

function formatSlots(slots: ComfyUiSlots): string {
	return COMFYUI_SLOT_NAMES.map((name) => {
		const ref = slots[name];
		return `${name}=${ref === null ? "无" : `${ref.nodeId}.${ref.input}`}`;
	}).join("，");
}

function parseImagesArgs(args: readonly string[]): ImagesArgs {
	if (args[0] !== "images") throw new Error(USAGE);
	if (args[1] === "profiles") return parseProfilesArgs(args);
	if (args[1] !== "workflow") throw new Error(USAGE);
	const action = args[2];
	if (
		action !== "import" &&
		action !== "list" &&
		action !== "show" &&
		action !== "delete"
	) {
		throw new Error(USAGE);
	}
	const allowed: Readonly<Record<string, true>> =
		action === "import"
			? { file: true, name: true, db: true, images: true, slots: true }
			: { db: true };
	const values = new Map<string, string>();
	let positional: string | null = null;
	for (let index = 3; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			if (positional !== null) {
				throw new Error(`多余的参数 ${arg}；${USAGE}`);
			}
			positional = arg;
			continue;
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (allowed[key] !== true) {
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
	const dbPath =
		values.get("db") ?? path.join(repoRoot, "data", "dramaticer.db");
	if (action === "list") {
		if (positional !== null)
			throw new Error(`多余的参数 ${positional}；${USAGE}`);
		return { action, dbPath };
	}
	if (action === "import") {
		if (positional !== null)
			throw new Error(`多余的参数 ${positional}；${USAGE}`);
		const file = values.get("file");
		const name = values.get("name");
		if (file === undefined) throw new Error(`--file 必须是非空路径；${USAGE}`);
		if (name === undefined) throw new Error(`--name 必须是非空名称；${USAGE}`);
		const imagesPath =
			values.get("images") ?? path.join(repoRoot, "data", "images.yaml");
		const rawSlots = values.get("slots");
		let slots: unknown;
		if (rawSlots !== undefined) {
			try {
				slots = JSON.parse(rawSlots);
			} catch {
				throw new Error(`--slots 必须是合法 JSON；${USAGE}`);
			}
		}
		return { action, dbPath, imagesPath, file, name, slots };
	}
	if (positional === null) {
		throw new Error(`${action} 需要 workflow id；${USAGE}`);
	}
	return { action, dbPath, id: positional };
}

function parseProfilesArgs(
	args: readonly string[],
): Extract<ImagesArgs, { readonly action: "profiles" }> {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	for (let index = 2; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (!arg.startsWith("--")) {
			throw new Error(`多余的参数 ${arg}；${USAGE}`);
		}
		const equals = arg.indexOf("=");
		const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
		if (key === "json" || key === "generate") {
			if (equals !== -1) {
				throw new Error(`--${key} 不接受值；${USAGE}`);
			}
			if (flags.has(key)) {
				throw new Error(`参数 --${key} 重复；${USAGE}`);
			}
			flags.add(key);
			continue;
		}
		if (key !== "story" && key !== "db") {
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
	const storyId = values.get("story");
	if (storyId === undefined) {
		throw new Error(`--story 必须是非空故事 id；${USAGE}`);
	}
	return {
		action: "profiles",
		dbPath: values.get("db") ?? path.join(repoRoot, "data", "dramaticer.db"),
		storyId,
		json: flags.has("json"),
		generate: flags.has("generate"),
	};
}
