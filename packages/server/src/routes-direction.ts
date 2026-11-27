// server 路由：剧情走向一页（两栏合并视图）与写入命令。
import type { IncomingMessage, ServerResponse } from "node:http";
import { applyDirectionEdit, readDirectionView } from "@dramaticer/core";
import type { DirectionEditResult, DirectionView } from "@dramaticer/protocol";
import { sendJson } from "./http.js";
import {
	fieldError,
	readObjectBody,
	requireMethod,
	requireStory,
	toBadRequest,
} from "./routes-common.js";
import type { ApiRouteOptions } from "./routes.js";

/** `GET /api/stories/:id/direction`：合并后的两栏。 */
export function handleDirection(
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): void {
	requireStory(options.store, storyId);
	const view: DirectionView = readDirectionView(options.store, storyId);
	sendJson(res, 200, view);
}

/**
 * `POST /api/stories/:id/direction/edit`：编辑、锁定、删除、收线。
 * 写入仍落在原来的楼层记录与玩家修改上，旧接口不受影响。
 */
export async function handleDirectionEdit(
	req: IncomingMessage,
	res: ServerResponse,
	options: ApiRouteOptions,
	storyId: string,
): Promise<void> {
	requireStory(options.store, storyId);
	const body = await readObjectBody(req, options.maxJsonBodyBytes);
	let result: DirectionEditResult;
	try {
		result = applyDirectionEdit(options.store, storyId, body);
	} catch (error) {
		throw toBadRequest(error, "direction");
	}
	sendJson(res, 200, result);
}

/**
 * 剧情走向的故事级路由分发；返回 true 表示已经处理。
 * `parts` 是整条路径按 `/` 切开的结果。
 */
export async function handleDirectionRoute(
	req: IncomingMessage,
	res: ServerResponse,
	method: string,
	options: ApiRouteOptions,
	storyId: string,
	parts: readonly string[],
): Promise<boolean> {
	const [, , third, fourth] = parts;
	if (third !== "direction") return false;
	if (fourth === undefined && parts.length === 3) {
		requireMethod(method, ["GET"]);
		handleDirection(res, options, storyId);
		return true;
	}
	if (fourth === "edit" && parts.length === 4) {
		requireMethod(method, ["POST"]);
		await handleDirectionEdit(req, res, options, storyId);
		return true;
	}
	throw fieldError("direction", `没有这个接口：${parts.join("/")}`);
}
