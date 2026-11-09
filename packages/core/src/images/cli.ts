import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../env.js";
import { StoryStore } from "../store/story-store.js";
import { type ImagesConfig, loadImagesConfig } from "./config.js";
import {
	COMFYUI_SLOT_NAMES,
	type ComfyUiSlotDetection,
	type ComfyUiSlots,
	assertComfyUiSlots,
	detectComfyUiSlots,
	parseComfyUiWorkflow,
} from "./slots.js";
import type { ImageWorkflowRecord } from "./types.js";
import { resolveImageProvider } from "./workflows.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const USAGE =
	"用法：dramaticer images workflow import --file <路径> --name <名称> [--db <路径>] [--images <路径>] [--slots <json>] | list [--db <路径>] | show <id> [--db <路径>] | delete <id> [--db <路径>]";

type ImagesAction = "import" | "list" | "show" | "delete";

export interface ImagesCliDependencies {
	readonly log?: (message: string) => void;
	readonly envPath?: string;
	readonly loadEnv?: (path: string) => void;
	readonly loadConfig?: (path: string) => Promise<ImagesConfig>;
}

export interface ImagesCliResult {
	readonly action: ImagesAction;
	readonly workflows: readonly ImageWorkflowRecord[];
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
	| { readonly action: "delete"; readonly dbPath: string; readonly id: string };

/** `dramaticer images workflow`：导入、列出、查看与删除 ComfyUI workflow。 */
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
		if (parsed.action === "list") {
			const workflows = store.listImageWorkflows();
			logWorkflows(workflows, log);
			return { action: "list", workflows };
		}
		if (parsed.action === "show") {
			const workflow = requireWorkflow(store, parsed.id);
			log(JSON.stringify(workflow, null, 2));
			return { action: "show", workflows: [workflow] };
		}
		if (parsed.action === "delete") {
			const workflow = requireWorkflow(store, parsed.id);
			store.deleteImageWorkflow(parsed.id);
			log(`已删除 workflow ${workflow.id}（${workflow.name}）`);
			return { action: "delete", workflows: [workflow] };
		}
		return await importWorkflow(parsed, store, dependencies, log);
	} finally {
		store.close();
	}
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
	return { action: "import", workflows: [saved] };
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
	if (args[0] !== "images" || args[1] !== "workflow") {
		throw new Error(USAGE);
	}
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
