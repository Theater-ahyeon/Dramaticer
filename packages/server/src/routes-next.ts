import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type BackgroundHealth,
	DIRECTOR_ACTION_LABELS,
	LLM_MODEL_ROLE_NAMES,
	type LlmModelRole,
	countOpenPromises,
	isDirectorActionKind,
	parseChannelsConfig,
	readBackgroundHealth,
	readDirectorArrangementLineId,
	readDirectorInterferenceStats,
	readEffectiveEdits,
	readPinnedLineIds,
	readRerollRates,
	readSceneSegments,
	readStoryPromiseLimit,
	resolveModelForRole,
	undoDirectorArrangement,
} from "@dramaticer/core";
import { HttpError, sendJson } from "./http.js";
import { handleCardRoute } from "./routes-card.js";
import {
	fieldError,
	readObjectBody,
	requireMethod,
	requireStory,
} from "./routes-common.js";
import { handleMemoryRoute } from "./routes-memory.js";
import type { ApiRouteOptions } from "./routes.js";

/**
 * v4 工单新增的故事级接口集中在这里，`routes.ts` 只在分发处问一句。
 * 返回 true 表示已经处理。
 */
export async function handleNextStoryRoute(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
	parts: readonly string[],
	url: URL,
): Promise<boolean> {
	const [, , third, fourth, fifth] = parts;
	if (await handleMemoryRoute(req, res, method, options, storyId, parts, url)) {
		return true;
	}
	if (await handleCardRoute(req, res, method, options, storyId, parts)) {
		return true;
	}
	if (third === "stats" && fourth === "rerolls" && parts.length === 4) {
		requireMethod(method, ["GET"]);
		requireStory(options.store, storyId);
		sendJson(res, 200, readRerollRates(options.store, storyId));
		return true;
	}
	if (third === "background" && fourth === "health" && parts.length === 4) {
		requireMethod(method, ["GET"]);
		requireStory(options.store, storyId);
		sendJson(res, 200, await backgroundHealthView(options, storyId));
		return true;
	}
	if (third === "overview" && parts.length === 3) {
		requireMethod(method, ["GET"]);
		requireStory(options.store, storyId);
		sendJson(res, 200, storyOverview(options, storyId));
		return true;
	}
	if (third === "floors" && parts.length === 3) {
		requireMethod(method, ["GET"]);
		requireStory(options.store, storyId);
		sendJson(res, 200, storyFloors(options, storyId));
		return true;
	}
	if (third === "director") {
		if (fourth === "stats" && parts.length === 4) {
			requireMethod(method, ["GET"]);
			requireStory(options.store, storyId);
			sendJson(res, 200, readDirectorInterferenceStats(options.store, storyId));
			return true;
		}
		if (fourth === "lines" && parts.length === 4) {
			requireMethod(method, ["GET"]);
			requireStory(options.store, storyId);
			sendJson(res, 200, directorLinesView(options, storyId));
			return true;
		}
		if (fourth === "muted" && parts.length === 4) {
			requireMethod(method, ["GET"]);
			requireStory(options.store, storyId);
			sendJson(res, 200, directorLinesView(options, storyId));
			return true;
		}
		if (fourth === "muted" && fifth !== undefined && parts.length === 5) {
			requireMethod(method, ["PUT", "DELETE"]);
			requireStory(options.store, storyId);
			if (method === "PUT") {
				options.store.muteDirectorLine(storyId, fifth, null);
			} else {
				options.store.unmuteDirectorLine(storyId, fifth);
			}
			sendJson(res, 200, directorLinesView(options, storyId));
			return true;
		}
		if (fourth === "undo" && parts.length === 4) {
			requireMethod(method, ["POST"]);
			requireStory(options.store, storyId);
			const body = await readObjectBody(req, options.maxJsonBodyBytes);
			const nodeId = body.nodeId;
			if (typeof nodeId !== "string" || nodeId.length === 0) {
				throw fieldError("nodeId", "撤回导演安排必须提供 nodeId");
			}
			const node = options.store.getNode(nodeId);
			if (node === null || node.storyId !== storyId) {
				throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
			}
			// 决策记在玩家楼层上；界面传回复楼层时往上找一层。
			const lineId = readDirectorArrangementLineId(
				options.store,
				storyId,
				nodeId,
			);
			if (lineId === null) {
				throw fieldError(
					"nodeId",
					"这一楼的导演安排没有对应的剧情线，无法撤回",
				);
			}
			await undoDirectorArrangement({
				store: options.store,
				storyId,
				nodeId,
				lineId,
			});
			sendJson(res, 200, {
				...directorLinesView(options, storyId),
				mutedLineId: lineId,
			});
			return true;
		}
	}
	return false;
}

function directorLinesView(options: ApiRouteOptions, storyId: string) {
	const head = options.store.getHead(storyId);
	const muted = options.store.listMutedDirectorLines(storyId);
	const mutedIds = new Set(muted.map((item) => item.lineId));
	const states =
		head === null ? [] : options.store.readDirectorLineStates(head.id);
	const pinned = readPinnedLineIds(options.store, storyId);
	const edits = readEffectiveEdits(options.store, storyId, null, "line");
	const depth =
		head === null
			? 0
			: options.store
					.getPathToNode(head.id)
					.filter((node) => node.role === "assistant").length;
	return {
		storyId,
		headNodeId: head?.id ?? null,
		muted,
		pinned,
		maxOpenPromises: readStoryPromiseLimit(options.store, storyId),
		lines: states.map((state) => ({
			...state.line,
			pinned: pinned.includes(state.line.id),
			locked: edits.get(state.line.id)?.locked === true,
			by: edits.get(state.line.id)?.value != null ? "player" : "ai",
			openedDepth: state.openedDepth,
			lastTouchedDepth: state.lastTouchedDepth,
			remaining:
				state.line.countdown === null
					? null
					: state.line.countdown - (depth - state.lastTouchedDepth),
			muted: mutedIds.has(state.line.id),
		})),
	};
}

/** 去掉块标签后的正文开头，给书架与「上回说到」用。 */
function plainExcerpt(raw: string, max: number): string {
	const text = raw
		.replace(/<([a-zA-Z_][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function storyOverview(options: ApiRouteOptions, storyId: string) {
	const store = options.store;
	const head = store.getHead(storyId);
	if (head === null) {
		return {
			storyId,
			floors: 0,
			chapter: 1,
			lines: 0,
			openPromises: 0,
			recap: "",
			updatedAt: null,
		};
	}
	const path = store.getPathToNode(head.id);
	const assistants = path.filter((node) => node.role === "assistant");
	const states = store.readDirectorLineStates(head.id);
	const promises = countOpenPromises(states);
	const last = assistants.at(-1);
	return {
		storyId,
		floors: path.length,
		chapter: store.listDirectorChapterReviewsAlongPath(head.id).length + 1,
		lines: states.length - promises,
		openPromises: promises,
		recap: last === undefined ? "" : plainExcerpt(last.raw, 160),
		updatedAt: head.createdAt,
	};
}

interface FloorNote {
	readonly tone: "gold" | "plain";
	readonly title: string;
	readonly text: string;
	/** 这条批注是导演的安排并且锚定了一条剧情线时，可以撤回。 */
	readonly undoLineId?: string;
}

/** 当前路径上每一楼的场次条、批注与开销；正文仍从路径接口读。 */
function storyFloors(options: ApiRouteOptions, storyId: string) {
	const store = options.store;
	const head = store.getHead(storyId);
	if (head === null) return { storyId, headNodeId: null, floors: [] };
	const fullPath = store.getPathToNode(head.id);
	const path = fullPath.slice(-80);
	const firstFloorNo = fullPath.length - path.length + 1;
	const muted = new Set(
		store.listMutedDirectorLines(storyId).map((item) => item.lineId),
	);
	const sceneStarts = new Map<string, number>();
	readSceneSegments(store, head.id).forEach((segment, index) => {
		sceneStarts.set(segment.startNodeId, index + 1);
	});
	const floors = path.map((node, index) => {
		const notes: FloorNote[] = [];
		let slate: {
			scene: number;
			present: readonly string[];
			change: string | null;
		} | null = null;
		let cost: {
			input: number | null;
			output: number | null;
			cached: number | null;
			waitMs: number | null;
			mode: string;
		} | null = null;
		if (node.role === "assistant") {
			const scene = store.getSceneLog(node.id);
			const sceneNo = sceneStarts.get(node.id);
			if (sceneNo !== undefined) {
				slate = {
					scene: sceneNo,
					present: scene?.present ?? [],
					change: scene?.sceneCard?.change ?? null,
				};
			}
			const decision =
				store.getDirectorDecision(node.id) ??
				(node.parentId === null
					? null
					: store.getDirectorDecision(node.parentId));
			if (decision !== null) {
				const action = decision.signals.action;
				const lineId = decision.signals.lineId;
				const reason =
					decision.mechanisms.find((item) => item.triggered)?.reason ??
					decision.mechanisms[0]?.reason ??
					"";
				if (decision.directive === null) {
					notes.push({
						tone: "plain",
						title: "导演 · 不干预",
						text: reason || "这一轮没有加任何安排",
					});
				} else if (typeof lineId === "string" && muted.has(lineId)) {
					notes.push({
						tone: "gold",
						title: "导演 · 已撤回",
						text: "这条安排不会再出现",
					});
				} else {
					notes.push({
						tone: "gold",
						title: `导演 · ${isDirectorActionKind(action) ? DIRECTOR_ACTION_LABELS[action] : "安排"}`,
						text: reason,
						...(typeof lineId === "string" ? { undoLineId: lineId } : {}),
					});
				}
			}
			for (const diff of store.getStateDiffs(node.id).slice(0, 6)) {
				notes.push({
					tone: "plain",
					title: diff.path[0] === "userWill" ? "偏好" : "状态",
					text:
						diff.op === "delete"
							? `${diff.path.join(" · ")}：移除`
							: `${diff.path.join(" · ")}：${summarize(diff.value)}`,
				});
			}
			const trace = store.getTurnTrace(node.id);
			if (trace !== null) {
				cost = {
					input: trace.llm.usage.promptTokens,
					output: trace.llm.usage.completionTokens,
					cached: trace.llm.usage.cachedTokens,
					waitMs: trace.timing.firstTokenMs,
					mode: trace.turnMode,
				};
			}
		}
		return {
			nodeId: node.id,
			role: node.role,
			no: firstFloorNo + index,
			slate,
			notes,
			cost,
		};
	});
	return { storyId, headNodeId: head.id, floors };
}

function summarize(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (text === undefined) return "";
	return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** 后台是否暂停，加上用到出错模型的岗位；渠道文件读不了时岗位留空。 */
async function backgroundHealthView(
	options: ApiRouteOptions,
	storyId: string,
): Promise<BackgroundHealth & { readonly roles: readonly LlmModelRole[] }> {
	const health = readBackgroundHealth(options.store, storyId);
	if (health.model === null || options.channelsPath === null) {
		return { ...health, roles: [] };
	}
	try {
		const config = parseChannelsConfig(
			await readFile(options.channelsPath, "utf8"),
			options.channelsEnv,
			options.channelsPath,
		);
		const roles = LLM_MODEL_ROLE_NAMES.filter((role) => {
			try {
				return (
					config.models.get(resolveModelForRole(config, role))?.id ===
					health.model
				);
			} catch {
				return false;
			}
		});
		return { ...health, roles };
	} catch {
		return { ...health, roles: [] };
	}
}
