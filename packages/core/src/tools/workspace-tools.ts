import type { TurnDraftController } from "../chat/draft.js";
import type { TurnNoteController } from "../chat/notes.js";
import {
	applyDirectorNoteDiffs,
	formatDirectorNotes,
} from "../director/notes.js";
import { assertPlainObject, rejectUnknownKeys } from "../json.js";
import {
	compileWikiPages,
	readMemoryPrefs,
	readMemorySecrets,
	readMemoryState,
	readMemoryTimeline,
} from "../memory/view.js";
import type { StoryStore } from "../store/story-store.js";
import type { ReadToolContext } from "./read-tools.js";
import type { DeepToolDefinition } from "./registry.js";

export const DRAFT_FILE_PATH = "草稿.md";

const STORY_DIR = "故事";
const STATE_FILE = `${STORY_DIR}/状态.md`;
const SECRET_FILE = `${STORY_DIR}/秘密.md`;
const BEAT_FILE = `${STORY_DIR}/节拍.md`;
const TIMELINE_FILE = `${STORY_DIR}/时间线.md`;
const PREF_FILE = `${STORY_DIR}/偏好.md`;
const PROMISE_FILE = `${STORY_DIR}/伏笔.md`;
const BLUEPRINT_FILE = `${STORY_DIR}/大纲.md`;
const NOTES_FILE = `${STORY_DIR}/手记.md`;
const HISTORY_FILE = `${STORY_DIR}/历史.md`;
const CHARACTER_DIR = `${STORY_DIR}/人物`;

const MAX_SEARCH_LIMIT = 40;
const MAX_SEARCH_RESULT_CHARS = 6_000;
const MAX_FILE_CHARS = 24_000;
const MAX_HISTORY_FLOORS = 10;
const MAX_HISTORY_FLOOR_CHARS = 1_200;

export const FILE_READ_TOOL_NAME = "file_read";
export const FILE_SEARCH_TOOL_NAME = "file_search";
export const FILE_WRITE_TOOL_NAME = "file_write";
export const FILE_PATCH_TOOL_NAME = "file_patch";

const FILE_READ_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		path: {
			type: "string",
			description: "工作区里的文件路径，例如 草稿.md 或 故事/状态.md。",
		},
	},
	required: ["path"],
	additionalProperties: false,
};

const FILE_SEARCH_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		query: { type: "string", description: "要搜索的文字。" },
		limit: {
			type: "integer",
			minimum: 1,
			maximum: MAX_SEARCH_LIMIT,
			description: "最多返回多少行，默认 20。",
		},
	},
	required: ["query"],
	additionalProperties: false,
};

const FILE_WRITE_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		path: {
			type: "string",
			description: "只能是 草稿.md；故事数据文件只读。",
		},
		text: { type: "string", description: "草稿的新正文，整份替换。" },
	},
	required: ["path", "text"],
	additionalProperties: false,
};

const FILE_PATCH_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		path: {
			type: "string",
			description: "只能是 草稿.md；故事数据文件只读。",
		},
		oldText: {
			type: "string",
			description: "草稿里要被替换的文字；必须在草稿里恰好出现一次。",
		},
		newText: { type: "string", description: "替换后的文字。" },
	},
	required: ["path", "oldText", "newText"],
	additionalProperties: false,
};

export const FILE_READ_TOOL: DeepToolDefinition = {
	name: FILE_READ_TOOL_NAME,
	description:
		"读取工作区里的一个文件。故事数据按文件树呈现：故事/状态.md、故事/秘密.md、故事/节拍.md、故事/时间线.md、故事/偏好.md、故事/伏笔.md、故事/大纲.md、故事/手记.md、故事/历史.md，以及 故事/人物/<名字>.md。草稿是 草稿.md。",
	parameters: FILE_READ_SCHEMA,
	permission: "read",
	progressLabel: "读取工作区文件……",
};

export const FILE_SEARCH_TOOL: DeepToolDefinition = {
	name: FILE_SEARCH_TOOL_NAME,
	description:
		"在工作区的全部文件里按文字搜索，返回命中的文件、行号与该行内容。用来定位人物、地点与旧事。",
	parameters: FILE_SEARCH_SCHEMA,
	permission: "read",
	progressLabel: "搜索故事数据……",
};

export const FILE_WRITE_TOOL: DeepToolDefinition = {
	name: FILE_WRITE_TOOL_NAME,
	description:
		"整份替换本轮草稿（草稿.md）。草稿只有交稿后才会成为楼层；故事数据文件只读，要改它们就在正文里写出来。",
	parameters: FILE_WRITE_SCHEMA,
	permission: "control",
	progressLabel: "改写草稿……",
};

export const FILE_PATCH_TOOL: DeepToolDefinition = {
	name: FILE_PATCH_TOOL_NAME,
	description:
		"按原文定位修改本轮草稿（草稿.md）的一处：oldText 必须在草稿里恰好出现一次。修改故事数据文件不开放。",
	parameters: FILE_PATCH_SCHEMA,
	permission: "control",
	progressLabel: "修补草稿……",
};

export const WORKSPACE_TOOLS: readonly DeepToolDefinition[] = [
	FILE_READ_TOOL,
	FILE_SEARCH_TOOL,
	FILE_WRITE_TOOL,
	FILE_PATCH_TOOL,
];

export function isWorkspaceReadToolName(
	name: string,
): name is typeof FILE_READ_TOOL_NAME | typeof FILE_SEARCH_TOOL_NAME {
	return name === FILE_READ_TOOL_NAME || name === FILE_SEARCH_TOOL_NAME;
}

export interface WorkspaceContext {
	readonly store: StoryStore;
	readonly storyId: string;
	/** 当前用户楼层；所有快照都沿它的路径取。 */
	readonly anchorNodeId: string;
	readonly draft: TurnDraftController | null;
	readonly notes: TurnNoteController | null;
}

function contextOf(input: ReadToolContext): WorkspaceContext {
	return {
		store: input.store,
		storyId: input.storyId,
		anchorNodeId: input.beforeNodeId,
		draft: input.draft ?? null,
		notes: input.notes ?? null,
	};
}

interface CharacterFile {
	readonly path: string;
	readonly name: string;
	readonly text: string;
}

function characterFiles(context: WorkspaceContext): CharacterFile[] {
	const files: CharacterFile[] = [];
	const used = new Set<string>();
	for (const page of compileWikiPages(
		context.store,
		context.storyId,
		context.anchorNodeId,
	)) {
		let name = page.name.replace(/[\\/:*?"<>|\n\r\t]/g, "_").trim();
		if (name.length === 0) name = page.id;
		let path = `${CHARACTER_DIR}/${name}.md`;
		let suffix = 2;
		while (used.has(path)) {
			path = `${CHARACTER_DIR}/${name}-${suffix}.md`;
			suffix += 1;
		}
		used.add(path);
		const sections = page.sections.map(
			(section) =>
				`## ${section.title}\n${section.statements
					.map(
						(statement) =>
							`- ${statement.text}${statement.floorNo === null ? "" : `（第 ${statement.floorNo} 楼）`}`,
					)
					.join("\n")}`,
		);
		const lines = [
			`# ${page.name}（${page.kind}）`,
			page.aliases.length > 1 ? `别名：${page.aliases.join("、")}` : "",
			page.lead,
			...sections,
		].filter((line) => line.length > 0);
		files.push({ path, name: page.name, text: lines.join("\n\n") });
	}
	return files;
}

/** 工作区里当前可见的文件路径，顺序固定；草稿排在最前。 */
export function listWorkspacePaths(context: WorkspaceContext): string[] {
	return [
		DRAFT_FILE_PATH,
		STATE_FILE,
		SECRET_FILE,
		BEAT_FILE,
		TIMELINE_FILE,
		PREF_FILE,
		PROMISE_FILE,
		BLUEPRINT_FILE,
		NOTES_FILE,
		HISTORY_FILE,
		...characterFiles(context).map((file) => file.path),
	];
}

function normalizePath(path: string): string {
	const trimmed = path.trim().replace(/\\/g, "/");
	const withoutLeading = trimmed.replace(/^\/+/, "");
	const segments = withoutLeading.split("/");
	if (segments.some((segment) => segment === ".." || segment === ".")) {
		throw new Error(`文件路径不能包含 . 或 ..：${path}`);
	}
	return segments.filter((segment) => segment.length > 0).join("/");
}

function show(value: unknown): string {
	if (typeof value === "string") return value;
	const text = JSON.stringify(value);
	return text === undefined ? "" : text;
}

function renderState(context: WorkspaceContext): string {
	const items = readMemoryState(
		context.store,
		context.storyId,
		context.anchorNodeId,
	);
	if (items.length === 0) return "还没有记下任何状态。";
	const groups = new Map<string, string[]>();
	for (const item of items) {
		const lines = groups.get(item.owner) ?? [];
		lines.push(`- ${item.item}：${show(item.value)}（第 ${item.floorNo} 楼）`);
		groups.set(item.owner, lines);
	}
	return [...groups.entries()]
		.map(([owner, lines]) => `## ${owner}\n${lines.join("\n")}`)
		.join("\n\n");
}

function renderSecrets(context: WorkspaceContext): string {
	const secrets = readMemorySecrets(
		context.store,
		context.storyId,
		context.anchorNodeId,
	);
	if (secrets.length === 0) return "还没有记下任何秘密。";
	return secrets
		.map(
			(secret) =>
				`- 「${secret.text}」\n  知道：${secret.knowers.join("、")}\n  不知道：${secret.unaware.join("、")}`,
		)
		.join("\n");
}

function renderBeats(context: WorkspaceContext): string {
	const path = context.store.getPathToNode(context.anchorNodeId);
	const beats: string[] = [];
	for (const node of path) {
		if (node.role !== "assistant") continue;
		const log = context.store.getSceneLog(node.id);
		if (log === null) continue;
		beats.push(
			`- 第 ${path.indexOf(node) + 1} 楼：${log.beat}；在场：${log.present.join("、")}${log.sceneEnds ? "；这一场结束" : ""}`,
		);
	}
	if (beats.length === 0) return "还没有记下任何节拍。";
	return beats.slice(-8).join("\n");
}

function renderTimeline(context: WorkspaceContext): string {
	const scenes = readMemoryTimeline(
		context.store,
		context.storyId,
		context.anchorNodeId,
	);
	if (scenes.length === 0) return "还没有场次摘要。";
	return scenes
		.map(
			(scene) =>
				`## ${scene.title}（${scene.floors} 楼）\n${scene.summary}\n在场：${scene.present.join("、")}\n变化：${scene.changes.join("；") || "没有记下"}`,
		)
		.join("\n\n");
}

function renderPrefs(context: WorkspaceContext): string {
	const prefs = readMemoryPrefs(
		context.store,
		context.storyId,
		context.anchorNodeId,
	).filter((pref) => !pref.disabled);
	if (prefs.length === 0) return "还没有记下玩家的偏好。";
	return prefs.map((pref) => `- ${pref.text}（${pref.origin}）`).join("\n");
}

function renderPromises(context: WorkspaceContext): string {
	const promises = context.store
		.readDirectorLineStates(context.anchorNodeId)
		.filter((item) => item.line.kind === "promise");
	if (promises.length === 0) return "还没有埋下伏笔。";
	return promises
		.map((item) => {
			const countdown =
				item.line.countdown === null ? "" : `；还剩 ${item.line.countdown} 楼`;
			return `- ${item.line.who} 想要${item.line.want}；阻碍：${item.line.obstacle}${countdown}`;
		})
		.join("\n");
}

function renderBlueprint(context: WorkspaceContext): string {
	const entries = context.store.readBlueprintEntries(context.anchorNodeId);
	if (entries.length === 0) return "还没有大纲。";
	return entries.map((entry) => JSON.stringify(entry, null, 2)).join("\n\n");
}

function renderNotes(context: WorkspaceContext): string {
	const entries = applyDirectorNoteDiffs(
		context.store.readDirectorNoteEntries(context.anchorNodeId),
		context.notes?.pending ?? [],
	);
	if (entries.length === 0) return "还没有导演手记。";
	return formatDirectorNotes(entries);
}

function renderHistory(context: WorkspaceContext): string {
	const path = context.store.getPathToNode(context.anchorNodeId);
	const recent = path.slice(-MAX_HISTORY_FLOORS);
	return recent
		.map((node, index) => {
			const label = node.role === "user" ? "玩家" : "助手";
			const raw =
				node.raw.length > MAX_HISTORY_FLOOR_CHARS
					? `${node.raw.slice(0, MAX_HISTORY_FLOOR_CHARS)}……（已截断）`
					: node.raw;
			return `- 第 ${path.length - recent.length + index + 1} 楼（${label}）：${raw}`;
		})
		.join("\n");
}

/** 读一个工作区文件；故事数据是快照，草稿是最新版本。 */
export function readWorkspaceFile(
	path: string,
	context: WorkspaceContext,
): string {
	const normalized = normalizePath(path);
	if (normalized === DRAFT_FILE_PATH) {
		if (context.draft === null) return "本轮没有草稿工作区。";
		if (context.draft.text.trim().length === 0) {
			return "草稿还是空的。用 file_write 写第一版，或直接输出正文。";
		}
		return context.draft.text;
	}
	const character = characterFiles(context).find(
		(file) => file.path === normalized,
	);
	if (character !== undefined) return character.text;
	switch (normalized) {
		case STATE_FILE:
			return renderState(context);
		case SECRET_FILE:
			return renderSecrets(context);
		case BEAT_FILE:
			return renderBeats(context);
		case TIMELINE_FILE:
			return renderTimeline(context);
		case PREF_FILE:
			return renderPrefs(context);
		case PROMISE_FILE:
			return renderPromises(context);
		case BLUEPRINT_FILE:
			return renderBlueprint(context);
		case NOTES_FILE:
			return renderNotes(context);
		case HISTORY_FILE:
			return renderHistory(context);
		default:
			throw new Error(
				`没有这个文件：${path}。可用文件：${listWorkspacePaths(context).join("、")}`,
			);
	}
}

function fit(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}\n……（已截断）` : text;
}

export function searchWorkspace(
	query: string,
	limit: number,
	context: WorkspaceContext,
): string {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) throw new Error("file_search.query 必须是非空字符串");
	const hits: string[] = [];
	for (const path of listWorkspacePaths(context)) {
		const text = readWorkspaceFile(path, context);
		const lines = text.split("\n");
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index] ?? "";
			if (!line.toLowerCase().includes(needle)) continue;
			hits.push(`- ${path}:${index + 1}：${line.trim()}`);
			if (hits.length >= limit) {
				return fit(`搜索「${query}」：\n${hits.join("\n")}`, MAX_SEARCH_RESULT_CHARS);
			}
		}
	}
	if (hits.length === 0) return `工作区里没有找到「${query}」。`;
	return fit(`搜索「${query}」：\n${hits.join("\n")}`, MAX_SEARCH_RESULT_CHARS);
}

export interface WorkspaceToolOutcome {
	readonly content: string;
	readonly ok: boolean;
	readonly error: string | null;
}

export function executeWorkspaceReadTool(
	name: string,
	value: unknown,
	context: WorkspaceContext,
): WorkspaceToolOutcome {
	if (name === FILE_READ_TOOL_NAME) {
		const args = assertPlainObject(value, FILE_READ_TOOL_NAME);
		rejectUnknownKeys(args, ["path"], FILE_READ_TOOL_NAME);
		if (typeof args.path !== "string" || args.path.trim().length === 0) {
			throw new Error(`${FILE_READ_TOOL_NAME}.path 必须是非空字符串`);
		}
		const text = readWorkspaceFile(args.path, context);
		return { content: fit(text, MAX_FILE_CHARS), ok: true, error: null };
	}
	if (name === FILE_SEARCH_TOOL_NAME) {
		const args = assertPlainObject(value, FILE_SEARCH_TOOL_NAME);
		rejectUnknownKeys(args, ["query", "limit"], FILE_SEARCH_TOOL_NAME);
		if (typeof args.query !== "string" || args.query.trim().length === 0) {
			throw new Error(`${FILE_SEARCH_TOOL_NAME}.query 必须是非空字符串`);
		}
		const rawLimit = args.limit;
		let limit = 20;
		if (rawLimit !== undefined) {
			if (
				!Number.isInteger(rawLimit) ||
				(rawLimit as number) < 1 ||
				(rawLimit as number) > MAX_SEARCH_LIMIT
			) {
				throw new Error(
					`${FILE_SEARCH_TOOL_NAME}.limit 必须是 1 到 ${MAX_SEARCH_LIMIT} 之间的整数`,
				);
			}
			limit = rawLimit as number;
		}
		return {
			content: searchWorkspace(args.query, limit, context),
			ok: true,
			error: null,
		};
	}
	throw new Error(`未知的工作区读取工具：${name}`);
}

function requireDraft(
	draft: TurnDraftController | null,
): TurnDraftController {
	if (draft === null) throw new Error("本轮没有草稿工作区");
	return draft;
}

function requireDraftPath(path: unknown, tool: string): void {
	if (typeof path !== "string" || path.trim().length === 0) {
		throw new Error(`${tool}.path 必须是非空字符串`);
	}
	if (normalizePath(path) !== DRAFT_FILE_PATH) {
		throw new Error(
			`${path} 只读；故事数据文件不能直接改，本轮只能修改 ${DRAFT_FILE_PATH}`,
		);
	}
}

export function executeWorkspaceWriteTool(
	value: unknown,
	draft: TurnDraftController | null,
): WorkspaceToolOutcome {
	const args = assertPlainObject(value, FILE_WRITE_TOOL_NAME);
	rejectUnknownKeys(args, ["path", "text"], FILE_WRITE_TOOL_NAME);
	requireDraftPath(args.path, FILE_WRITE_TOOL_NAME);
	if (typeof args.text !== "string") {
		throw new Error(`${FILE_WRITE_TOOL_NAME}.text 必须是字符串`);
	}
	const snapshot = requireDraft(draft).replace(args.text);
	return {
		content: `草稿已替换为第 ${snapshot.version} 版（${snapshot.text.length} 字）。`,
		ok: true,
		error: null,
	};
}

export function executeWorkspacePatchTool(
	value: unknown,
	draft: TurnDraftController | null,
): WorkspaceToolOutcome {
	const args = assertPlainObject(value, FILE_PATCH_TOOL_NAME);
	rejectUnknownKeys(
		args,
		["path", "oldText", "newText"],
		FILE_PATCH_TOOL_NAME,
	);
	requireDraftPath(args.path, FILE_PATCH_TOOL_NAME);
	if (typeof args.oldText !== "string" || args.oldText.length === 0) {
		throw new Error(`${FILE_PATCH_TOOL_NAME}.oldText 必须是非空字符串`);
	}
	if (typeof args.newText !== "string") {
		throw new Error(`${FILE_PATCH_TOOL_NAME}.newText 必须是字符串`);
	}
	const current = requireDraft(draft);
	if (current.text.length === 0) {
		throw new Error("草稿还是空的；先用 file_write 写整份草稿，再打补丁");
	}
	const first = current.text.indexOf(args.oldText);
	if (first === -1) {
		throw new Error(`草稿里找不到要替换的文字：${args.oldText}`);
	}
	if (current.text.indexOf(args.oldText, first + 1) !== -1) {
		throw new Error(
			`草稿里有多处「${args.oldText}」，无法确定改哪一处；多写几个字再试`,
		);
	}
	const next =
		current.text.slice(0, first) +
		args.newText +
		current.text.slice(first + args.oldText.length);
	const snapshot = current.replace(next);
	return {
		content: `草稿已修补为第 ${snapshot.version} 版（${snapshot.text.length} 字）。`,
		ok: true,
		error: null,
	};
}

/** 深回合的系统消息：把文件树摆在模型面前，给出读、搜、改草稿与交稿的入口。 */
export function formatWorkspaceGuide(context: WorkspaceContext): string {
	const paths = listWorkspacePaths(context);
	const preview =
		paths.length > 40
			? [...paths.slice(0, 40), `……还有 ${paths.length - 40} 个文件`]
			: paths;
	return [
		"【工作区】这一楼在草稿工作区里完成。故事数据按文件树呈现，都是只读快照：",
		...preview.map((path) => `- ${path}`),
		"读文件用 file_read；搜故事数据用 file_search；写草稿用 file_write；按原文改一处用 file_patch。改完用 commit_draft 交稿；直接输出正文也会成为楼层。",
	].join("\n");
}

export { contextOf as workspaceContextOf };
