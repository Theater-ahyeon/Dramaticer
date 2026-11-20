// 前端体积预算（ui-lite 规格）：构建之后运行，超了就以非零退出码失败。
// 首屏 JS 指 index.html 直接引用和预加载的脚本；按需加载的分包不算。
// 用法：node scripts/budget.mjs [--dist dist] [--js-kb 200] [--css-kb 40]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const DEFAULT_LIMITS = { jsKb: 200, cssKb: 40 };
const FONT = /\.(woff2?|ttf|otf|eot)$/i;

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function gzipKb(path) {
	return gzipSync(readFileSync(path), { level: 9 }).length / 1024;
}

/** 检查一个构建目录，返回各项体积和超出的项目；不抛错，由调用方决定怎么报。 */
export function checkBudget(distDir, limits = DEFAULT_LIMITS) {
	const html = readFileSync(join(distDir, "index.html"), "utf8");
	const scripts = new Set();
	for (const match of html.matchAll(
		/<script[^>]*\bsrc="([^"]+)"|<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g,
	)) {
		const src = match[1] ?? match[2];
		if (src !== undefined && !/^https?:/.test(src)) scripts.add(src);
	}
	const files = walk(distDir);
	const jsKb = [...scripts].reduce(
		(sum, src) => sum + gzipKb(join(distDir, src.replace(/^\//, ""))),
		0,
	);
	const cssKb = files
		.filter((path) => path.endsWith(".css"))
		.reduce((sum, path) => sum + gzipKb(path), 0);
	const fonts = files.filter((path) => FONT.test(path));
	const failures = [];
	if (jsKb > limits.jsKb) {
		failures.push(`首屏 JS ${jsKb.toFixed(1)} KB > ${limits.jsKb} KB`);
	}
	if (cssKb > limits.cssKb) {
		failures.push(`CSS ${cssKb.toFixed(1)} KB > ${limits.cssKb} KB`);
	}
	if (fonts.length > 0) {
		failures.push(`不应打包字体文件，发现 ${fonts.length} 个`);
	}
	return { jsKb, cssKb, fonts: fonts.length, failures };
}

function argValue(args, name) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const args = process.argv.slice(2);
	const dist = resolve(argValue(args, "--dist") ?? "dist");
	const limits = {
		jsKb: Number(argValue(args, "--js-kb") ?? DEFAULT_LIMITS.jsKb),
		cssKb: Number(argValue(args, "--css-kb") ?? DEFAULT_LIMITS.cssKb),
	};
	const result = checkBudget(dist, limits);
	console.log(
		`体积预算：首屏 JS ${result.jsKb.toFixed(1)} / ${limits.jsKb} KB，CSS ${result.cssKb.toFixed(1)} / ${limits.cssKb} KB（gzip），字体文件 ${result.fonts} 个`,
	);
	if (result.failures.length > 0) {
		for (const failure of result.failures) console.error(`超出预算：${failure}`);
		process.exit(1);
	}
}
