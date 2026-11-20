// server 路由：各路由文件共用的参数校验、错误响应与视图转换（refactor/06 从 routes.ts 拆出）。
import type { IncomingMessage } from "node:http";
import {
	DIRECTOR_CONFIG_KEYS,
	STORY_SETTINGS_UPDATE_KEYS,
	type Story,
	type StoryStore,
	type TimelineNode,
	isJsonObject,
} from "@dramaticer/core";
import { HttpError, readJsonBody } from "./http.js";

export function requireNode(store: StoryStore, nodeId: string): TimelineNode {
	const node = store.getNode(nodeId);
	if (node === null) {
		throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
	}
	return node;
}

/** 故事级接口里的节点必须属于路径里的故事，跨故事一律按不存在处理。 */
export function requireStoryNode(
	store: StoryStore,
	storyId: string,
	nodeId: string,
): TimelineNode {
	const node = store.getNode(nodeId);
	if (node === null || node.storyId !== storyId) {
		throw new HttpError(404, "not_found", `楼层节点不存在：${nodeId}`);
	}
	return node;
}

export function queryInteger(
	url: URL,
	name: string,
	min: number,
	max: number,
): number | undefined {
	const raw = url.searchParams.get(name);
	if (raw === null) return undefined;
	if (!/^\d+$/.test(raw)) {
		throw fieldError(name, `${name} 必须是非负整数`);
	}
	const value = Number(raw);
	if (value < min || value > max) {
		throw fieldError(name, `${name} 必须在 ${min} 到 ${max} 之间`);
	}
	return value;
}

export const IMAGE_MEDIA_TYPES: Readonly<Record<string, true>> = {
	"image/png": true,
	"image/jpeg": true,
	"image/webp": true,
	"image/gif": true,
};

export function requireStory(store: StoryStore, storyId: string): Story {
	const story = store.getStory(storyId);
	if (story === null) {
		throw new HttpError(404, "not_found", `故事不存在：${storyId}`);
	}
	return story;
}

export async function readObjectBody(
	req: IncomingMessage,
	maxJsonBodyBytes: number,
): Promise<Record<string, unknown>> {
	const body = await readJsonBody(req, maxJsonBodyBytes);
	if (!isJsonObject(body)) {
		throw fieldError("body", "请求体必须是 JSON 对象");
	}
	return body as Record<string, unknown>;
}

export function assertKnownKeys(
	object: Record<string, unknown>,
	allowed: readonly string[],
	path = "body",
): void {
	for (const key of Object.keys(object)) {
		if (!allowed.includes(key)) {
			throw fieldError(
				path === "body" ? key : `${path}.${key}`,
				`未知字段：${key}`,
			);
		}
	}
}

export function requireObject(
	value: unknown,
	path: string,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw fieldError(path, `${path} 必须是对象`);
	}
	return value as Record<string, unknown>;
}

export function requireText(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw fieldError(path, `${path} 必须是非空字符串`);
	}
	return value.trim();
}

/** 楼层原文可以带首尾空白，只要求去掉空白后不为空。 */
export function requireRawText(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw fieldError(path, `${path} 必须是非空字符串`);
	}
	return value;
}

export function fieldError(path: string, message: string): HttpError {
	return new HttpError(400, "bad_request", message, { path });
}

export function toBadRequest(error: unknown, path: string): HttpError {
	if (error instanceof HttpError) return error;
	const message = error instanceof Error ? error.message : String(error);
	return fieldError(path, message);
}

export function inferSettingsPath(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	for (const key of STORY_SETTINGS_UPDATE_KEYS) {
		if (message.includes(key)) return key;
	}
	for (const key of DIRECTOR_CONFIG_KEYS) {
		if (message.includes(key)) return `directorConfig.${key}`;
	}
	return "body";
}

export function pathSegments(pathname: string): string[] {
	const body = pathname.slice("/api/".length);
	if (body.length === 0) return [];
	return body.split("/").map((segment) => {
		try {
			return decodeURIComponent(segment);
		} catch {
			throw fieldError("path", "请求路径里的编码不合法");
		}
	});
}

export function requireMethod(
	method: string,
	allowed: readonly string[],
): void {
	if (!allowed.includes(method)) {
		throw new HttpError(405, "bad_request", `不支持的请求方法：${method}`);
	}
}
