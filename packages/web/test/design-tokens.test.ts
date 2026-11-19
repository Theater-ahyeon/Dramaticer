import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// 设计系统的硬约束（ui-lite/02）：两套主题的文字都过 WCAG AA，暗色的两处定义一致，
// 不用玻璃模糊，样式表压缩后不超过预算。
const v4 = readFileSync(new URL("../src/v4/v4.css", import.meta.url), "utf8");
const legacy = readFileSync(
	new URL("../src/styles.css", import.meta.url),
	"utf8",
);

function block(css: string, opener: string): string {
	const start = css.indexOf(opener);
	if (start < 0) throw new Error(`找不到 ${opener}`);
	const open = css.indexOf("{", start + opener.length - 1);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

type Rgba = readonly [number, number, number, number];

function tokens(body: string): Map<string, Rgba> {
	const map = new Map<string, Rgba>();
	for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
		const color = parseColor(value?.trim() ?? "");
		if (name !== undefined && color !== null) map.set(name, color);
	}
	return map;
}

function parseColor(value: string): Rgba | null {
	const hex = /^#([0-9a-f]{6})$/i.exec(value);
	if (hex?.[1] !== undefined) {
		const n = Number.parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
	}
	const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
	if (rgba !== null) {
		return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
	}
	return null;
}

function over(top: Rgba, base: Rgba): Rgba {
	const a = top[3];
	return [
		top[0] * a + base[0] * (1 - a),
		top[1] * a + base[1] * (1 - a),
		top[2] * a + base[2] * (1 - a),
		1,
	];
}

function luminance([r, g, b]: Rgba): number {
	const f = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(block(v4, "html:root {"));
const darkMedia = block(v4, 'html:root:not([data-theme="light"]) {');
const darkFixed = block(v4, 'html:root[data-theme="dark"] {');
const dark = new Map([...light, ...tokens(darkFixed)]);

describe.each([
	["亮（纸）", light],
	["暗（墨）", dark],
])("%s主题", (_name, theme) => {
	const get = (name: string): Rgba => {
		const value = theme.get(name);
		if (value === undefined) throw new Error(`缺少颜色 --${name}`);
		return value;
	};
	const surfaces = ["bg", "sheet", "raise", "field"] as const;
	const texts = ["ink", "muted", "slate", "cinnabar-ink", "ok", "bad"] as const;

	it.each(
		surfaces.flatMap((surface) =>
			texts.map((text) => [text, surface] as const),
		),
	)("文字 --%s 在 --%s 上不低于 4.5:1", (text, surface) => {
		expect(contrast(get(text), get(surface))).toBeGreaterThanOrEqual(4.5);
	});

	it("朱砂主按钮上的文字不低于 4.5:1", () => {
		expect(
			contrast(get("on-cinnabar"), get("cinnabar")),
		).toBeGreaterThanOrEqual(4.5);
	});

	it.each([
		["cinnabar-ink", "cinnabar-wash"],
		["ok", "ok-wash"],
		["bad", "bad-wash"],
		["muted", "soft"],
	] as const)("标记文字 --%s 在 --%s 底上不低于 4.5:1", (text, wash) => {
		const base = over(get(wash), get("sheet"));
		expect(contrast(get(text), base)).toBeGreaterThanOrEqual(4.5);
	});

	it("输入框与开关的边线不低于 3:1", () => {
		for (const surface of ["sheet", "field"] as const) {
			expect(contrast(get("line-strong"), get(surface))).toBeGreaterThanOrEqual(
				3,
			);
		}
	});
});

describe("样式表", () => {
	it("跟随系统的暗色与手动固定的暗色定义一致", () => {
		const norm = (body: string) =>
			body
				.split(";")
				.map((line) => line.trim())
				.filter(Boolean)
				.sort();
		expect(norm(darkMedia)).toEqual(norm(darkFixed));
	});

	it("不使用玻璃模糊", () => {
		expect(v4).not.toMatch(/backdrop-filter/);
		expect(legacy).not.toMatch(/backdrop-filter/);
	});

	it("压缩后不超过 40 KB", () => {
		const size = gzipSync(v4 + legacy, { level: 9 }).length;
		expect(size).toBeLessThanOrEqual(40 * 1024);
	});
});
