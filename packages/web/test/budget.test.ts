import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBudget } from "../scripts/budget.mjs";

const dirs: string[] = [];

function fakeDist(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "budget-"));
	dirs.push(dir);
	mkdirSync(join(dir, "assets"));
	for (const [path, content] of Object.entries(files)) {
		writeFileSync(join(dir, path), content);
	}
	return dir;
}

// 随机内容压不小，用来模拟超预算的产物。
function noise(bytes: number): string {
	let text = "";
	for (let i = 0; i < bytes; i++) {
		text += String.fromCharCode(33 + Math.floor(Math.random() * 90));
	}
	return text;
}

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

const html = (extra = "") =>
	`<script type="module" src="/assets/main.js"></script>${extra}<link rel="stylesheet" href="/assets/main.css">`;

describe("前端体积预算", () => {
	it("小产物通过", () => {
		const dir = fakeDist({
			"index.html": html(),
			"assets/main.js": "console.log(1)",
			"assets/main.css": "body{}",
		});
		expect(checkBudget(dir).failures).toEqual([]);
	});

	it("首屏 JS 超了就失败，按需分包不算首屏", () => {
		const dir = fakeDist({
			"index.html": html(),
			"assets/main.js": noise(4 * 1024),
			"assets/lazy.js": noise(40 * 1024),
			"assets/main.css": "body{}",
		});
		const result = checkBudget(dir, { jsKb: 2, cssKb: 40 });
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain("首屏 JS");
		expect(result.jsKb).toBeLessThan(10);
	});

	it("预加载的脚本算进首屏", () => {
		const dir = fakeDist({
			"index.html": html('<link rel="modulepreload" href="/assets/vendor.js">'),
			"assets/main.js": "1",
			"assets/vendor.js": noise(8 * 1024),
			"assets/main.css": "body{}",
		});
		expect(checkBudget(dir, { jsKb: 2, cssKb: 40 }).failures[0]).toContain(
			"首屏 JS",
		);
	});

	it("CSS 超了或打包了字体都失败", () => {
		const dir = fakeDist({
			"index.html": html(),
			"assets/main.js": "1",
			"assets/main.css": noise(8 * 1024),
			"assets/serif.woff2": "x",
		});
		const failures = checkBudget(dir, { jsKb: 200, cssKb: 2 }).failures;
		expect(failures.some((item) => item.startsWith("CSS"))).toBe(true);
		expect(failures.some((item) => item.includes("字体"))).toBe(true);
	});
});
