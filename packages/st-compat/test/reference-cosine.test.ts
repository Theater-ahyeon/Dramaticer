import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	calibrateReferenceCosine,
	parseCosineCalibration,
} from "../src/reference/cosine.js";

const testRoot = path.dirname(fileURLToPath(import.meta.url));

function fakeEmbedder(dimensions = 2) {
	const calls: string[][] = [];
	return {
		calls,
		dimensions,
		async embed(texts: readonly string[]): Promise<number[][]> {
			calls.push([...texts]);
			return texts.map((text) => (text.startsWith("甲") ? [1, 0] : [0, 1]));
		},
	};
}

describe("calibrateReferenceCosine", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(path.join(testRoot, ".tmp-cosine-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("按作品取样相邻块并计算余弦分位", async () => {
		await writeFile(
			path.join(root, "甲.txt"),
			["甲一", "甲二", "甲三", "甲四"].join("\n"),
			"utf8",
		);
		await writeFile(
			path.join(root, "乙.txt"),
			["乙一", "乙二"].join("\n"),
			"utf8",
		);
		const embedder = fakeEmbedder();
		const calibration = await calibrateReferenceCosine({
			referenceRoot: root,
			embedder,
			modelLabel: "fake@2",
			pairsPerWork: 2,
		});
		expect(calibration.works).toHaveLength(2);
		expect(calibration.pairCount).toBe(3);
		expect(calibration.blockCount).toBe(5);
		expect(calibration.duplicatePairCount).toBe(0);
		expect(calibration.meanCosine).toBe(1);
		expect(calibration.percentiles.p99).toBe(1);
		expect(calibration.works.map((work) => work.name).sort()).toEqual(
			["乙", "甲"].sort(),
		);
		expect(embedder.calls).toHaveLength(1);
		expect(embedder.calls[0]).toHaveLength(5);
	});

	it("不同类别的相邻块余弦为 0", async () => {
		await writeFile(
			path.join(root, "甲.txt"),
			["甲一", "乙一"].join("\n"),
			"utf8",
		);
		const calibration = await calibrateReferenceCosine({
			referenceRoot: root,
			embedder: fakeEmbedder(),
			modelLabel: "fake@2",
		});
		expect(calibration.pairCount).toBe(1);
		expect(calibration.meanCosine).toBe(0);
		expect(calibration.percentiles.p99).toBe(0);
	});

	it("参照目录为空时返回空校准", async () => {
		const calibration = await calibrateReferenceCosine({
			referenceRoot: path.join(root, "missing"),
			embedder: fakeEmbedder(),
			modelLabel: "fake@2",
		});
		expect(calibration.pairCount).toBe(0);
		expect(calibration.works).toEqual([]);
	});

	it("取样数量非法时抛错", async () => {
		await expect(
			calibrateReferenceCosine({
				referenceRoot: root,
				embedder: fakeEmbedder(),
				modelLabel: "fake@2",
				pairsPerWork: 0,
			}),
		).rejects.toThrow("pairsPerWork 必须是正整数");
	});
});

describe("parseCosineCalibration", () => {
	const valid = {
		modelLabel: "fake@2",
		pairsPerWork: 1,
		blockCount: 2,
		pairCount: 1,
		duplicatePairCount: 0,
		meanCosine: 0.5,
		percentiles: { p50: 0.5, p90: 0.5, p95: 0.5, p99: 0.5 },
		works: [{ name: "甲", pairCount: 1, meanCosine: 0.5, p95Cosine: 0.5 }],
	};

	it("读取合法校准", () => {
		const parsed = parseCosineCalibration(valid);
		expect(parsed.works[0].name).toBe("甲");
		expect(parsed.percentiles.p99).toBe(0.5);
	});

	it("拒绝缺少分位与非法计数", () => {
		expect(() => parseCosineCalibration({})).toThrow("percentiles");
		expect(() =>
			parseCosineCalibration({
				...valid,
				percentiles: { p50: 0, p90: 0, p95: 0 },
			}),
		).toThrow("p99");
		expect(() => parseCosineCalibration({ ...valid, pairCount: -1 })).toThrow(
			"非负整数",
		);
		expect(() => parseCosineCalibration({ ...valid, modelLabel: "" })).toThrow(
			"非空字符串",
		);
	});
});
