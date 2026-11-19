import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type BlueprintDiff,
	type JsonValue,
	type PlayerEditKind,
	assertDirectorLine,
	assertSceneCard,
	compileWikiPages,
	createTokenEstimator,
	editSceneGoal,
	editState,
	editWikiStatement,
	isPlayerEditKind,
	loreEntryMatchScore,
	normalizeEntityName,
	readContextBreakdown,
	readEditHistory,
	readEffectiveEdits,
	readLoreCopy,
	readMemoryPrefs,
	readMemoryRecords,
	readMemorySecrets,
	readMemoryState,
	readMemoryTimeline,
	readPinnedLineIds,
	readSceneGoal,
	readWritingView,
	resetToCardRecommended,
	resolveLoreInjectionRole,
	rollbackPlayerEdit,
	stateTargetOf,
	writeMemoryPref,
	writeWritingOverrides,
} from "@dramaticer/core";
import { HttpError, sendJson } from "./http.js";
import { allow, bad, readObject, requireStory } from "./routes-next.js";
import type { ApiRouteOptions } from "./routes.js";

/** 记忆、设定副本、剧情线修改、大纲修改与写作选项的接口。返回 true 表示已处理。 */
export async function handleMemoryRoute(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
	parts: readonly string[],
	url: URL,
): Promise<boolean> {
	const [, , third, fourth, fifth] = parts;
	const store = options.store;
	const head = () => store.getHead(storyId)?.id ?? null;

	if (third === "memory") {
		requireStory(options, storyId);
		if (parts.length === 3) {
			allow(method, ["GET"]);
			sendJson(res, 200, {
				storyId,
				headNodeId: head(),
				pages: compileWikiPages(store, storyId),
				state: readMemoryState(store, storyId),
				secrets: readMemorySecrets(store, storyId),
				timeline: readMemoryTimeline(store, storyId),
				prefs: readMemoryPrefs(store, storyId),
				rejections: store.listMemoryRejections(storyId, 30),
			});
			return true;
		}
		if (fourth === "records" && parts.length === 4) {
			allow(method, ["GET"]);
			sendJson(res, 200, {
				storyId,
				records: readMemoryRecords(store, storyId),
			});
			return true;
		}
		if (fourth === "history" && parts.length === 4) {
			allow(method, ["GET"]);
			const kind = url.searchParams.get("kind");
			const target = url.searchParams.get("target");
			if (!isPlayerEditKind(kind) || target === null) {
				throw bad("kind", "查看历史必须提供 kind 与 target");
			}
			sendJson(res, 200, {
				storyId,
				kind,
				target,
				edits: readEditHistory(store, storyId, null, kind, target),
				versions:
					kind === "state"
						? (readMemoryState(store, storyId).find(
								(item) => item.target === target,
							)?.history ?? [])
						: [],
			});
			return true;
		}
		if (parts.length === 4) {
			allow(method, ["POST"]);
			const body = await readObject(req, options);
			try {
				switch (fourth) {
					case "state": {
						const path = body.path;
						if (
							!Array.isArray(path) ||
							path.some((item) => typeof item !== "string")
						) {
							throw bad("path", "path 必须是字符串数组");
						}
						editState(
							store,
							storyId,
							null,
							path as string[],
							body.value === undefined ? null : (body.value as JsonValue),
						);
						break;
					}
					case "edit":
						saveEdit(options, storyId, body);
						break;
					case "prefs":
						writeMemoryPref(store, storyId, {
							...(typeof body.id === "string" ? { id: body.id } : {}),
							...(typeof body.text === "string" ? { text: body.text } : {}),
							...(typeof body.disabled === "boolean"
								? { disabled: body.disabled }
								: {}),
						});
						break;
					case "rollback": {
						if (typeof body.editId === "number") {
							rollbackPlayerEdit(store, storyId, head(), body.editId);
						} else if (typeof body.target === "string") {
							// 状态可以回到任何一次历史取值，不限于玩家改过的版本。
							editState(
								store,
								storyId,
								null,
								JSON.parse(body.target) as string[],
								body.value === undefined ? null : (body.value as JsonValue),
							);
						} else {
							throw bad(
								"editId",
								"回滚必须提供 editId，或状态的 target 与 value",
							);
						}
						break;
					}
					default:
						return false;
				}
			} catch (error) {
				// 校验失败的原因原样带回去，界面在原处显示。
				if (error instanceof HttpError) throw error;
				throw bad(
					fourth ?? "body",
					error instanceof Error ? error.message : String(error),
				);
			}
			sendJson(res, 200, { ok: true });
			return true;
		}
	}

	if (third === "context" && parts.length === 3) {
		allow(method, ["GET"]);
		requireStory(options, storyId);
		const requested = url.searchParams.get("nodeId");
		let nodeId = requested;
		if (nodeId === null) {
			const anchor = head();
			const path = anchor === null ? [] : store.getPathToNode(anchor);
			nodeId =
				[...path].reverse().find((node) => node.role === "assistant")?.id ??
				null;
		}
		sendJson(res, 200, {
			storyId,
			nodeId,
			breakdown: nodeId === null ? null : readContextBreakdown(store, nodeId),
		});
		return true;
	}

	if (third === "dock" && parts.length === 3) {
		allow(method, ["GET"]);
		requireStory(options, storyId);
		sendJson(res, 200, dockView(options, storyId));
		return true;
	}

	if (third === "lore-copy") {
		requireStory(options, storyId);
		if (parts.length === 3) {
			allow(method, ["GET"]);
			sendJson(res, 200, loreCopyView(options, storyId));
			return true;
		}
		if (fourth === "restore" && parts.length === 4) {
			allow(method, ["POST"]);
			for (const item of readLoreCopy(store, storyId)) {
				if (!item.edited && !item.disabled) continue;
				store.savePlayerEdit({
					storyId,
					nodeId: head(),
					kind: "lore",
					target: item.original.id,
					value: null,
					source: "restore",
					note: "恢复原卡",
				});
			}
			sendJson(res, 200, loreCopyView(options, storyId));
			return true;
		}
		if (fourth !== undefined && parts.length === 4) {
			allow(method, ["POST"]);
			const body = await readObject(req, options);
			const current = readLoreCopy(store, storyId).find(
				(item) => item.original.id === fourth,
			);
			if (current === undefined) {
				throw new HttpError(404, "not_found", `设定条目不存在：${fourth}`);
			}
			if (body.restore === true) {
				store.savePlayerEdit({
					storyId,
					nodeId: head(),
					kind: "lore",
					target: fourth,
					value: null,
					source: "restore",
					note: "恢复原卡",
				});
			} else {
				const content =
					typeof body.content === "string"
						? body.content
						: current.entry.content;
				if (content.trim().length === 0) {
					throw bad("content", "条目内容不能为空；不想用它可以停用");
				}
				store.savePlayerEdit({
					storyId,
					nodeId: head(),
					kind: "lore",
					target: fourth,
					value: {
						name:
							typeof body.name === "string" ? body.name : current.entry.name,
						content,
						constant:
							typeof body.constant === "boolean"
								? body.constant
								: current.entry.constant,
						keywords: Array.isArray(body.keywords)
							? body.keywords.filter(
									(item): item is string => typeof item === "string",
								)
							: [...current.entry.keywords],
					},
					locked: true,
					disabled:
						typeof body.disabled === "boolean"
							? body.disabled
							: current.disabled,
				});
			}
			sendJson(res, 200, loreCopyView(options, storyId));
			return true;
		}
		if (fourth !== undefined && fifth === "preview" && parts.length === 5) {
			allow(method, ["GET"]);
			sendJson(res, 200, lorePreview(options, storyId, fourth));
			return true;
		}
		if (fourth !== undefined && fifth === "history" && parts.length === 5) {
			allow(method, ["GET"]);
			sendJson(res, 200, {
				edits: readEditHistory(store, storyId, null, "lore", fourth),
			});
			return true;
		}
	}

	if (third === "director" && fourth === "scene" && parts.length === 4) {
		allow(method, ["POST"]);
		requireStory(options, storyId);
		const body = await readObject(req, options);
		try {
			saveSceneGoalEdit(options, storyId, body);
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw bad(
				"scene",
				error instanceof Error ? error.message : String(error),
			);
		}
		sendJson(res, 200, {
			ok: true,
			sceneGoal: sceneGoalView(options, storyId),
		});
		return true;
	}

	if (third === "director" && fourth === "line" && parts.length === 4) {
		allow(method, ["POST"]);
		requireStory(options, storyId);
		const body = await readObject(req, options);
		try {
			saveLineEdit(options, storyId, body);
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw bad("line", error instanceof Error ? error.message : String(error));
		}
		sendJson(res, 200, { ok: true });
		return true;
	}

	if (third === "blueprint" && fourth === "edit" && parts.length === 4) {
		allow(method, ["POST"]);
		requireStory(options, storyId);
		const body = await readObject(req, options);
		const nodeId = head();
		if (nodeId === null)
			throw bad("body", "故事还没有楼层，先写第一楼再改大纲");
		try {
			if (typeof body.versionNodeId === "string") {
				store.rollbackStoryBlueprint({
					nodeId,
					storyId,
					versionNodeId: body.versionNodeId,
					...(typeof body.versionSeq === "number"
						? { versionSeq: body.versionSeq }
						: {}),
				});
			} else {
				store.saveStoryBlueprint({
					nodeId,
					storyId,
					source: "player",
					diffs: body.diffs as BlueprintDiff[],
				});
			}
		} catch (error) {
			throw bad(
				"diffs",
				error instanceof Error ? error.message : String(error),
			);
		}
		sendJson(res, 200, {
			storyId,
			nodeId,
			entries: store.readBlueprintEntries(nodeId),
		});
		return true;
	}

	if (third === "blueprint" && fourth === "versions" && parts.length === 4) {
		allow(method, ["GET"]);
		requireStory(options, storyId);
		const nodeId = head();
		sendJson(res, 200, {
			storyId,
			versions:
				nodeId === null
					? []
					: store.listBlueprintVersions(nodeId).map((version) => ({
							nodeId: version.nodeId,
							seq: version.seq,
							source: version.source,
							createdAt: version.createdAt,
							changes: version.diffs.length,
						})),
		});
		return true;
	}

	if (third === "writing" && parts.length === 3) {
		allow(method, ["GET", "PUT", "DELETE"]);
		requireStory(options, storyId);
		if (method === "GET") {
			sendJson(res, 200, readWritingView(store, storyId));
		} else if (method === "DELETE") {
			sendJson(res, 200, resetToCardRecommended(store, storyId));
		} else {
			const body = await readObject(req, options);
			sendJson(res, 200, writeWritingOverrides(store, storyId, body));
		}
		return true;
	}

	return false;
}

const EDIT_TEXT_KINDS: readonly PlayerEditKind[] = [
	"secret",
	"wiki",
	"summary",
];

function saveEdit(
	options: ApiRouteOptions,
	storyId: string,
	body: Record<string, unknown>,
): void {
	const store = options.store;
	const kind = body.kind;
	const target = body.target;
	if (!isPlayerEditKind(kind) || !EDIT_TEXT_KINDS.includes(kind)) {
		throw bad("kind", "kind 只能是 secret、wiki 或 summary");
	}
	if (typeof target !== "string" || target.length === 0) {
		throw bad("target", "必须指明要改的对象");
	}
	if (kind === "wiki" && body.reset !== true) {
		const separator = target.lastIndexOf("|");
		const statementId = separator === -1 ? "" : target.slice(separator + 1);
		if (separator > 0 && statementId !== "lead") {
			let text: string | undefined;
			if (body.value !== undefined) {
				const next = body.value as JsonValue;
				const nextText =
					next !== null && typeof next === "object" && !Array.isArray(next)
						? next.text
						: undefined;
				if (typeof nextText !== "string" || nextText.trim().length === 0) {
					throw bad("value", "内容不能为空；不想要这一条可以删掉它");
				}
				text = nextText;
			}
			editWikiStatement(store, storyId, {
				pageId: target.slice(0, separator),
				statementId,
				...(text === undefined ? {} : { text }),
				...(typeof body.locked === "boolean" ? { locked: body.locked } : {}),
				...(typeof body.disabled === "boolean"
					? { disabled: body.disabled }
					: {}),
			});
			return;
		}
	}
	const nodeId = store.getHead(storyId)?.id ?? null;
	const current = readEffectiveEdits(store, storyId, nodeId, kind).get(target);
	if (body.reset === true) {
		// 撤销玩家的修改：回到自动整理的内容，并解除锁定。
		store.savePlayerEdit({
			storyId,
			nodeId,
			kind,
			target,
			value: null,
			source: "restore",
		});
		return;
	}
	let value: JsonValue | null = current?.value ?? null;
	if (body.value !== undefined) {
		const next = body.value as JsonValue;
		const text =
			next !== null && typeof next === "object" && !Array.isArray(next)
				? next.text
				: undefined;
		if (typeof text !== "string" || text.trim().length === 0) {
			throw bad("value", "内容不能为空；不想要这一条可以删掉它");
		}
		if (kind === "secret" && next !== null && typeof next === "object") {
			for (const field of ["knowers", "unaware"] as const) {
				const names = (next as Record<string, unknown>)[field];
				if (names === undefined) continue;
				if (
					!Array.isArray(names) ||
					names.some(
						(name) => typeof name !== "string" || name.trim().length === 0,
					)
				) {
					throw bad("value", `${field} 必须是名字组成的数组`);
				}
			}
		}
		value = next;
	}
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind,
		target,
		value,
		locked: typeof body.locked === "boolean" ? body.locked : true,
		disabled:
			typeof body.disabled === "boolean"
				? body.disabled
				: (current?.disabled ?? false),
	});
}

function saveLineEdit(
	options: ApiRouteOptions,
	storyId: string,
	body: Record<string, unknown>,
): void {
	const store = options.store;
	const nodeId = store.getHead(storyId)?.id ?? null;
	if (nodeId === null)
		throw bad("line", "故事还没有楼层，先写第一楼再加剧情线");
	if (typeof body.pin === "string") {
		const pinned = new Set(readPinnedLineIds(store, storyId));
		if (pinned.has(body.pin)) pinned.delete(body.pin);
		else pinned.add(body.pin);
		store.setStoryValue(storyId, "pinnedLines", [...pinned]);
		return;
	}
	const id =
		typeof body.id === "string"
			? body.id
			: body.line !== null && typeof body.line === "object"
				? (body.line as { id?: unknown }).id
				: undefined;
	if (typeof id !== "string" || id.length === 0) {
		throw bad("id", "必须指明是哪一条剧情线");
	}
	const current = readEffectiveEdits(store, storyId, nodeId, "line").get(id);
	const existing = store
		.readDirectorLineStates(nodeId)
		.find((state) => state.line.id === id);
	let value: JsonValue | null = current?.value ?? null;
	if (body.line !== undefined) {
		const line = assertDirectorLine(body.line, "line");
		value = JSON.parse(JSON.stringify(line)) as JsonValue;
	} else if (value === null && existing !== undefined) {
		// 只锁定不改内容时，把当前内容固定下来。
		value = JSON.parse(JSON.stringify(existing.line)) as JsonValue;
	}
	store.savePlayerEdit({
		storyId,
		nodeId,
		kind: "line",
		target: id,
		value,
		locked: typeof body.locked === "boolean" ? body.locked : true,
		disabled: body.disabled === true,
	});
}

function saveSceneGoalEdit(
	options: ApiRouteOptions,
	storyId: string,
	body: Record<string, unknown>,
): void {
	const store = options.store;
	const nodeId = store.getHead(storyId)?.id ?? null;
	if (nodeId === null) {
		throw bad("scene", "故事还没有楼层，先写第一楼再改本场目标");
	}
	const current = readSceneGoal(store, storyId, nodeId);
	if (current === null) {
		throw bad("scene", "这一场还没有目标，先等场记写下场面卡");
	}
	const present =
		body.present === undefined
			? current.present
			: Array.isArray(body.present)
				? body.present
				: null;
	if (present === null) {
		throw bad("present", "present 必须是在场者的数组");
	}
	const change = typeof body.change === "string" ? body.change : current.change;
	const card = assertSceneCard({ present, change }, "本场目标");
	editSceneGoal(store, storyId, nodeId, card, {
		locked: typeof body.locked === "boolean" ? body.locked : true,
	});
}

function loreCopyView(options: ApiRouteOptions, storyId: string) {
	const store = options.store;
	const estimate = createTokenEstimator();
	const audit = new Map(
		store
			.listImportAuditEntries(storyId)
			.map((entry) => [entry.source, entry] as const),
	);
	const copy = readLoreCopy(store, storyId);
	let before = 0;
	let after = 0;
	const kinds = new Map<string, number>();
	const entries = copy.map((item) => {
		const tokens = estimate(item.entry.content);
		const record = audit.get(item.original.source);
		const kind = record?.kind ?? "unknown";
		kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
		if (item.original.constant) before += estimate(item.original.content);
		// 优化后每轮固定带入的只剩常识类的常驻条目；其余按用法分流。
		if (
			!item.disabled &&
			item.entry.constant &&
			record?.memory !== true &&
			(kind === "common" || kind === "unknown" || kind === "rule")
		) {
			after += tokens;
		}
		return {
			id: item.original.id,
			source: item.original.source,
			name: item.entry.name,
			content: item.entry.content,
			constant: item.entry.constant,
			keywords: item.entry.keywords,
			kind,
			tokens,
			edited: item.edited,
			disabled: item.disabled,
			locked: item.locked,
		};
	});
	const settings = store.getStorySettings(storyId);
	return {
		storyId,
		cardName: settings.cardName ?? null,
		importMode: settings.importMode,
		entries,
		kinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })),
		fixedTokens: {
			before,
			after: settings.importMode === "raw" ? before : after,
		},
	};
}

/** 「现在会不会带上」：按当前场面检查一条设定这一轮是否会进上下文。 */
function lorePreview(
	options: ApiRouteOptions,
	storyId: string,
	entryId: string,
) {
	const store = options.store;
	const item = readLoreCopy(store, storyId).find(
		(candidate) => candidate.original.id === entryId,
	);
	if (item === undefined) {
		throw new HttpError(404, "not_found", `设定条目不存在：${entryId}`);
	}
	const rule = store
		.listImportAuditInjectionRules(storyId)
		.find((entry) => entry.source === item.original.source);
	const kind = rule?.kind ?? "unknown";
	const role = resolveLoreInjectionRole(
		item.entry,
		store.getStorySettings(storyId).importMode,
		rule,
	);
	let entityAliases: readonly string[] = [];
	if (item.entry.entityId !== null) {
		const entity = store.getEntity(item.entry.entityId);
		if (entity === null) {
			throw new Error(
				`世界书条目 ${item.entry.id} 关联的实体不存在：${item.entry.entityId}`,
			);
		}
		entityAliases = entity.aliases;
	}
	const head = store.getHead(storyId);
	const recent =
		head === null
			? ""
			: store
					.getPathToNode(head.id)
					.slice(-4)
					.map((node) => node.raw)
					.join("\n");
	const score = loreEntryMatchScore(
		item.entry,
		normalizeEntityName(recent),
		entityAliases,
	);
	const baseHit = role.base !== null;
	const matchedHit = role.matched && score > 0;
	const hit = !item.disabled && (baseHit || matchedHit);
	const condition = item.disabled
		? "已停用，不会带上"
		: role.base === "full"
			? "每一轮都带"
			: role.base === "index"
				? "每一轮带标题与关键词；提到时带全文"
				: role.matched
					? "提到关键词或关联人物时带上"
					: "这个类型不进入每轮上下文";
	let reason: string;
	if (item.disabled) reason = "这一条已停用，不会带上";
	else if (role.base === "full") reason = "每轮固定带入的条目，这一轮会带上";
	else if (role.base === "index") {
		reason = "每轮带入标题与关键词，这一轮会带上";
	} else if (matchedHit) {
		reason = "最近几楼提到了它的关键词或关联人物，这一轮会带上";
	} else if (!role.matched) {
		reason = "这个类型不进入每轮上下文，不会带上";
	} else {
		reason =
			item.entry.keywords.length === 0
				? "没有关键词，最近几楼也没有提到关联人物"
				: `最近几楼没有提到：${item.entry.keywords.slice(0, 6).join("、")}`;
	}
	return {
		id: entryId,
		kind,
		constant: item.entry.constant,
		keywords: item.entry.keywords,
		condition,
		hit,
		reason,
	};
}

function sceneGoalView(options: ApiRouteOptions, storyId: string) {
	const head = options.store.getHead(storyId);
	if (head === null) return null;
	const goal = readSceneGoal(options.store, storyId, head.id);
	if (goal === null) return null;
	return {
		nodeId: goal.nodeId,
		present: goal.present,
		change: goal.change,
		source: goal.source,
		locked: goal.locked,
	};
}

/** 故事页停靠栏的「记忆」一页：在场的人、秘密、快要相关的人。 */
function dockView(options: ApiRouteOptions, storyId: string) {
	const store = options.store;
	const head = store.getHead(storyId);
	if (head === null) {
		return {
			storyId,
			present: [],
			secrets: [],
			soon: [],
			sceneGoal: null,
			recap: null,
		};
	}
	const path = store.getPathToNode(head.id);
	const scene = store.getLatestSceneLogOnPath(head.id);
	const presentNames = scene?.present ?? [];
	const goal = sceneGoalView(options, storyId);
	const pages = compileWikiPages(store, storyId);
	const state = readMemoryState(store, storyId);
	const wants = new Map(
		(goal?.present ?? []).map((actor) => [actor.who, actor.want] as const),
	);
	const secrets = readMemorySecrets(store, storyId);
	const present = presentNames.map((name) => {
		const key = normalizeEntityName(name);
		const page = pages.find((candidate) =>
			[candidate.name, ...candidate.aliases].some(
				(alias) => normalizeEntityName(alias) === key,
			),
		);
		return {
			name,
			pageId: page?.id ?? null,
			want: wants.get(name) ?? null,
			hides: secrets
				.filter(
					(secret) =>
						secret.knowers.includes(name) && secret.unaware.length > 0,
				)
				.slice(0, 2)
				.map((secret) => secret.text),
			now: state
				.filter((item) =>
					item.path
						.slice(0, -1)
						.some((segment) => normalizeEntityName(segment) === key),
				)
				.slice(0, 4)
				.map((item) => ({
					target: item.target,
					path: item.path,
					item: item.item,
					value: item.value,
				})),
		};
	});
	const presentKeys = new Set(
		presentNames.map((name) => normalizeEntityName(name)),
	);
	const soon = pages
		.filter(
			(page) =>
				page.kind === "人物" &&
				page.uptoFloor > 0 &&
				!presentKeys.has(normalizeEntityName(page.name)),
		)
		.map((page) => ({
			pageId: page.id,
			name: page.name,
			floorsAgo: path.length - page.uptoFloor,
		}))
		.sort((left, right) => left.floorsAgo - right.floorsAgo)
		.slice(0, 5);
	return {
		storyId,
		present,
		secrets: secrets.slice(0, 8),
		soon,
		sceneGoal: goal,
		recap: readMemoryTimeline(store, storyId).at(-1)?.summary ?? null,
	};
}

export { stateTargetOf };
