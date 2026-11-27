// server 路由：楼层渲染、沙箱联网允许名单、交互桥状态读写与拒绝记录（v5 §7）。
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type DeclarativePlugin,
	type JsonValue,
	type SandboxRejection,
	type StoryStore,
	allowStorySandboxDomain,
	assertJsonValue,
	installStoryFloorRenderer,
	isSandboxRejectionKind,
	listSandboxRejections,
	parseDeclarativePlugin,
	readLedger,
	readStoryFloorRenderers,
	readStorySandboxDomains,
	recordSandboxRejection,
	storySandboxRendererSummaries,
	validateLedgerDiff,
} from "@dramaticer/core";
import type {
	SandboxRejectionView,
	SandboxRejectionsView,
	SandboxStateQueryView,
	SandboxStateWriteResult,
	StoryRenderRequest,
	StoryRenderView,
	StorySandboxView,
} from "@dramaticer/protocol";
import { HttpError, sendJson } from "./http.js";
import { renderStoryFloors } from "./renderers.js";
import {
	assertKnownKeys,
	fieldError,
	pathFromQuery,
	queryInteger,
	readObjectBody,
	requireMethod,
	requireObject,
	requireStory,
	requireStoryNode,
	requireText,
	toBadRequest,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";

export const MAX_RENDER_NODES = 200;

export function sandboxView(
	store: StoryStore,
	storyId: string,
): StorySandboxView {
	const domains = readStorySandboxDomains(store, storyId);
	return {
		storyId,
		allowedDomains: domains.allowed,
		detectedDomains: domains.detected,
		renderers: storySandboxRendererSummaries(store, storyId),
	};
}

export async function handleStoryRender(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	assertKnownKeys(body, ["nodeIds"]);
	const nodeIds = body.nodeIds;
	if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
		throw fieldError("nodeIds", "nodeIds 必须是非空数组");
	}
	if (nodeIds.length > MAX_RENDER_NODES) {
		throw fieldError("nodeIds", `一次最多渲染 ${MAX_RENDER_NODES} 个楼层`);
	}
	for (const [index, nodeId] of nodeIds.entries()) {
		if (typeof nodeId !== "string" || nodeId.length === 0) {
			throw fieldError(`nodeIds[${index}]`, "楼层 id 必须是非空字符串");
		}
	}
	const request: StoryRenderRequest = { nodeIds: nodeIds as string[] };
	const view: StoryRenderView = await renderStoryFloors(
		options.store,
		storyId,
		request.nodeIds,
	);
	sendJson(res, 200, view);
}

export async function handleStorySandboxRoute(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
	parts: readonly string[],
): Promise<void> {
	requireStory(options.store, storyId);
	const rest = parts.slice(3);
	if (rest.length === 0) {
		requireMethod(method, ["GET"]);
		sendJson(res, 200, sandboxView(options.store, storyId));
		return;
	}
	if (rest[0] === "domains" && rest.length === 1) {
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["domain", "allowed"]);
		const allow = body.allowed;
		if (typeof allow !== "boolean") {
			throw fieldError("allowed", "allowed 必须是布尔值");
		}
		let allowed: string[];
		try {
			allowed = allowStorySandboxDomain(
				options.store,
				storyId,
				body.domain,
				allow,
			);
		} catch (error) {
			throw toBadRequest(error, "domain");
		}
		sendJson(res, 200, {
			...sandboxView(options.store, storyId),
			allowedDomains: allowed,
		});
		return;
	}
	if (rest[0] === "renderers" && rest.length === 1) {
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["plugin"]);
		let parsed: DeclarativePlugin;
		try {
			parsed = parseDeclarativePlugin(body.plugin, "plugin");
			if (parsed.kind !== "floor-renderer") {
				throw new Error("只接受楼层渲染器插件");
			}
			installStoryFloorRenderer(options.store, storyId, parsed, "player");
		} catch (error) {
			throw toBadRequest(error, "plugin");
		}
		sendJson(res, 200, sandboxView(options.store, storyId));
		return;
	}
	if (rest[0] === "rejections" && rest.length === 1) {
		if (method === "GET") {
			const limit = queryInteger(url, "limit", 1, 200) ?? 50;
			const view: SandboxRejectionsView = {
				storyId,
				rejections: listSandboxRejections(options.store, storyId, limit).map(
					toRejectionView,
				),
			};
			sendJson(res, 200, view);
			return;
		}
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["nodeId", "renderer", "kind", "target", "reason"]);
		if (!isSandboxRejectionKind(body.kind)) {
			throw fieldError("kind", "kind 只能是 bridge 或 network");
		}
		const nodeId =
			body.nodeId === undefined || body.nodeId === null
				? null
				: requireStoryNode(
						options.store,
						storyId,
						requireText(body.nodeId, "nodeId"),
					).id;
		const rejection = recordSandboxRejection(options.store, {
			storyId,
			nodeId,
			renderer: boundedText(body.renderer, "renderer", 200),
			kind: body.kind,
			target: boundedText(body.target, "target", 500),
			reason: boundedText(body.reason, "reason", 500),
		});
		sendJson(res, 201, toRejectionView(rejection));
		return;
	}
	if (rest[0] === "state" && rest.length === 1) {
		if (method === "GET") {
			const nodeId = requireText(url.searchParams.get("nodeId"), "nodeId");
			const node = requireStoryNode(options.store, storyId, nodeId);
			const path = pathFromQuery(url);
			const value = readLedger(options.store, node.id, path);
			const view: SandboxStateQueryView = {
				nodeId: node.id,
				path,
				value: value === undefined ? null : (value as JsonValue),
			};
			sendJson(res, 200, view);
			return;
		}
		requireMethod(method, ["POST"]);
		const body = await readObjectBody(req, options.maxJsonBodyBytes);
		assertKnownKeys(body, ["renderer", "nodeId", "write"]);
		const renderer = boundedText(body.renderer, "renderer", 200);
		const node = requireStoryNode(
			options.store,
			storyId,
			requireText(body.nodeId, "nodeId"),
		);
		const write = requireObject(body.write, "write");
		assertKnownKeys(write, ["path", "op", "value"], "write");
		const stored = readStoryFloorRenderers(options.store, storyId).find(
			(entry) => entry.id === renderer,
		);
		if (stored === undefined) {
			throw new HttpError(403, "forbidden", `未知的楼层渲染器：${renderer}`);
		}
		if (!stored.definition.payload.permissions.includes("writeState")) {
			recordSandboxRejection(options.store, {
				storyId,
				nodeId: node.id,
				renderer,
				kind: "bridge",
				target: "writeState",
				reason: "渲染器没有声明 writeState 权限",
			});
			throw new HttpError(403, "forbidden", "渲染器没有声明 writeState 权限");
		}
		let written = 0;
		try {
			const path = writePath(write.path);
			const op = write.op;
			if (op !== "set" && op !== "delete") {
				throw new Error("write.op 只能是 set 或 delete");
			}
			if (op === "set") assertJsonValue(write.value, "write.value");
			validateLedgerDiff({
				path,
				op,
				...(op === "set" ? { value: write.value } : {}),
				source: "player",
			});
			const diffs =
				op === "set"
					? [
							{
								storyId,
								nodeId: node.id,
								path,
								op,
								value: write.value,
								source: "player",
								reason: `楼层渲染插件 ${renderer} 写入`,
							} as const,
						]
					: [
							{
								storyId,
								nodeId: node.id,
								path,
								op,
								source: "player",
								reason: `楼层渲染插件 ${renderer} 写入`,
							} as const,
						];
			written = options.store.appendStateDiffs(diffs).length;
		} catch (error) {
			recordSandboxRejection(options.store, {
				storyId,
				nodeId: node.id,
				renderer,
				kind: "bridge",
				target: "writeState",
				reason: error instanceof Error ? error.message : String(error),
			});
			throw toBadRequest(error, "write");
		}
		const result: SandboxStateWriteResult = {
			storyId,
			nodeId: node.id,
			written,
		};
		sendJson(res, 200, result);
		return;
	}
	throw new HttpError(404, "not_found", "没有这个接口");
}

function toRejectionView(rejection: SandboxRejection): SandboxRejectionView {
	return {
		id: rejection.id,
		nodeId: rejection.nodeId,
		renderer: rejection.renderer,
		kind: rejection.kind,
		target: rejection.target,
		reason: rejection.reason,
		createdAt: rejection.createdAt,
	};
}

function boundedText(value: unknown, path: string, max: number): string {
	const text = requireText(value, path);
	if (text.length > max) {
		throw fieldError(path, `${path} 不能超过 ${max} 个字符`);
	}
	return text;
}

/** 写入只接受台账命名空间：一条事实只能落在唯一的台账里（I12）。 */
function writePath(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("write.path 必须是非空数组");
	}
	return value.map((segment, index) => {
		if (typeof segment !== "string" || segment.length === 0) {
			throw new Error(`write.path[${index}] 必须是非空字符串`);
		}
		return segment;
	});
}
