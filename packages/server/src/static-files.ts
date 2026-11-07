import type { Stats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { HttpError } from "./http.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".wasm": "application/wasm",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
};

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export interface StaticFile {
	readonly path: string;
	readonly contentType: string;
}

/**
 * 把 URL 路径映射到 web 构建目录里的文件。找不到文件时回退到 index.html，
 * 交给前端路由处理；越界路径与逃出目录的符号链接一律拒绝。
 */
export async function resolveStaticFile(
	webRoot: string,
	pathname: string,
): Promise<StaticFile | null> {
	const segments = decodePath(pathname)
		.split("/")
		.filter((segment) => segment.length > 0);
	if (segments.some((segment) => segment === "..")) {
		throw new HttpError(403, "forbidden", "路径不允许包含上级目录");
	}
	const root = await realpathOrNull(resolve(webRoot));
	if (root === null) return null;
	const target = resolve(root, segments.join("/") || "index.html");
	if (!isInside(root, target)) {
		throw new HttpError(403, "forbidden", "路径越界");
	}
	const file = await resolveFile(root, target);
	if (file !== null) {
		return {
			path: file,
			contentType:
				CONTENT_TYPES[extname(file).toLowerCase()] ?? DEFAULT_CONTENT_TYPE,
		};
	}
	const fallback = await resolveFile(root, resolve(root, "index.html"));
	return fallback === null
		? null
		: { path: fallback, contentType: HTML_CONTENT_TYPE };
}

export async function serveStaticFile(
	res: ServerResponse,
	file: StaticFile,
	headOnly: boolean,
): Promise<void> {
	const content = await readFile(file.path);
	res.writeHead(200, {
		"Content-Type": file.contentType,
		"Content-Length": content.length,
		"Cache-Control": "no-cache",
		"X-Content-Type-Options": "nosniff",
	});
	res.end(headOnly ? undefined : content);
}

function decodePath(pathname: string): string {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		throw new HttpError(400, "bad_request", "路径编码不合法");
	}
	if (decoded.includes("\0") || decoded.includes("\\")) {
		throw new HttpError(403, "forbidden", "路径不合法");
	}
	return decoded;
}

async function resolveFile(
	root: string,
	target: string,
): Promise<string | null> {
	const real = await realpathOrNull(target);
	if (real === null) return null;
	if (!isInside(root, real)) {
		throw new HttpError(403, "forbidden", "路径越界");
	}
	const stats = await statOrNull(real);
	if (stats === null) return null;
	if (!stats.isDirectory()) return real;
	const index = await realpathOrNull(resolve(real, "index.html"));
	if (index === null) return null;
	if (!isInside(root, index)) {
		throw new HttpError(403, "forbidden", "路径越界");
	}
	return index;
}

async function realpathOrNull(target: string): Promise<string | null> {
	try {
		return await realpath(target);
	} catch (error) {
		if (isMissingPathError(error)) return null;
		throw error;
	}
}

async function statOrNull(target: string): Promise<Stats | null> {
	try {
		return await stat(target);
	} catch (error) {
		if (isMissingPathError(error)) return null;
		throw error;
	}
}

function isMissingPathError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function isInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}
