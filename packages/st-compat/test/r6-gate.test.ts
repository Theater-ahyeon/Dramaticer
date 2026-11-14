import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { R6_B1_FORMAT } from "../src/evalset/r6-b1.js";
import { R6_COMPARE_FORMAT } from "../src/evalset/r6-compare.js";
import { R6_DEEP_FORMAT } from "../src/evalset/r6-deep.js";
import { R6_FUNNEL_FORMAT } from "../src/evalset/r6-funnel.js";
import { runR6GateCli } from "../src/evalset/r6-gate-cli.js";
import {
	type R6GateRunReport,
	R6_GATE_FORMAT,
	formatR6GateReport,
	runR6Gate,
} from "../src/evalset/r6-gate.js";
import { R6_INSTRUMENT_FORMAT } from "../src/evalset/r6-instrument.js";
import { R6_PREFERENCE_FORMAT } from "../src/evalset/r6-preference.js";
import { R6_REPLAY_FORMAT } from "../src/evalset/r6-replay.js";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 200,
		});
	}
});

function makeDir(): string {
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-gate-"));
	createdDirs.push(dir);
	return dir;
}

async function writeJson(dir: string, name: string, value: unknown) {
	const file = path.join(dir, name);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	return file;
}

const STORIES = ["xianxia", "yuwang", "yinqi"] as const;

function instrumentJson(input: { readonly agreement?: number } = {}) {
	const accepted = input.agreement ?? 286;
	return {
		format: R6_INSTRUMENT_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		gateInput: {
			sameConfig: {
				plannedPairs: 43,
				pairs: { wins: 20, losses: 20, ties: 2, inconsistent: 1 },
				failures: 0,
				judgments: { completed: 86, failed: 0 },
			},
			humanLabels: {
				plannedPairs: 195,
				completedPairs: 195,
				acceptedChoices: accepted,
				judgments: 390,
				positionA: 211,
				failures: 0,
			},
		},
	};
}

function replayJson() {
	return {
		format: R6_REPLAY_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		summary: {
			gateInput: {
				abandoned: {
					plannedPairs: 43,
					pairs: { wins: 30, losses: 8, ties: 2, inconsistent: 2 },
					failures: 1,
					stories: [
						{ story: "xianxia", completedPairs: 17 },
						{ story: "yuwang", completedPairs: 8 },
						{ story: "yinqi", completedPairs: 17 },
					],
					judgments: { completed: 84, failed: 1 },
				},
				accepted: {
					plannedPairs: 43,
					pairs: { wins: 20, losses: 18, ties: 3, inconsistent: 2 },
					failures: 0,
					stories: [
						{ story: "xianxia", completedPairs: 17 },
						{ story: "yuwang", completedPairs: 8 },
						{ story: "yinqi", completedPairs: 18 },
					],
					judgments: { completed: 86, failed: 0 },
				},
			},
		},
	};
}

function compareJson(
	story: string,
	options: {
		readonly repetition?: { readonly native: number; readonly naive: number };
		readonly progression?: { readonly native: number; readonly naive: number };
		readonly probes?: {
			readonly consistent: number;
			readonly contradicted: number;
			readonly unknown: number;
			readonly failed: number;
		};
	} = {},
) {
	const repetition = options.repetition ?? { native: 0.05, naive: 0.06 };
	const progression = options.progression ?? { native: 0.8, naive: 0.7 };
	const probes = options.probes ?? {
		consistent: 8,
		contradicted: 2,
		unknown: 1,
		failed: 0,
	};
	return {
		format: R6_COMPARE_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		profiles: [
			{
				story,
				profile: "native",
				repetition: { pairs: 300, mean: repetition.native },
				progression: { samples: 300, mean: progression.native },
				probes,
			},
			{
				story,
				profile: "naive",
				repetition: { pairs: 300, mean: repetition.naive },
				progression: { samples: 300, mean: progression.naive },
				probes: { consistent: 0, contradicted: 0, unknown: 0, failed: 0 },
			},
		],
	};
}

function deepJson(
	input: { readonly toolCalls?: number; readonly wins?: number } = {},
) {
	return {
		format: R6_DEEP_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		summary: {
			plannedPairs: 24,
			pairs: {
				wins: input.wins ?? 18,
				losses: 4,
				ties: 1,
				inconsistent: 1,
			},
			failures: 0,
			turns: {
				completed: 60,
				failed: 2,
				toolCalls: input.toolCalls ?? 12,
			},
		},
	};
}

function preferenceJson(input: { readonly accepted?: number } = {}) {
	const accepted = input.accepted ?? 21;
	return {
		format: R6_PREFERENCE_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		summary: {
			accepted,
			abandoned: 7,
			ties: 1,
			inconsistent: 1,
			failures: 0,
		},
	};
}

function funnelJson() {
	return {
		format: R6_FUNNEL_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		summary: {
			contradicted: 6,
			classes: { "no-evidence": 1, "not-in-prompt": 4, "not-recalled": 1 },
			weakEvidence: 2,
			unattributed: 0,
			stories: [
				{
					story: "xianxia",
					contradicted: 6,
					classes: { "no-evidence": 1, "not-in-prompt": 4, "not-recalled": 1 },
					weakEvidence: 2,
				},
			],
		},
	};
}

function b1Json() {
	return {
		format: R6_B1_FORMAT,
		gateVersion: "v2",
		generatedAt: "2026-11-14T00:00:00.000Z",
		summary: {
			plannedPairs: 30,
			completedPairs: 28,
			pairs: { wins: 12, losses: 9, ties: 4, inconsistent: 3 },
			failures: 2,
			winRate: 12 / 21,
			wilson: { lower: 0.36, upper: 0.76, rate: 12 / 21 },
			insufficient: false,
		},
	};
}

interface Fixture {
	readonly dir: string;
	readonly instrument: string;
	readonly replay: string;
	readonly compares: readonly string[];
	readonly deep: string;
	readonly preference: string;
	readonly funnel: string;
	readonly b1: readonly string[];
}

async function writeFixture(
	overrides: {
		readonly instrument?: unknown;
		readonly deep?: unknown;
		readonly preference?: unknown;
		readonly compares?: readonly unknown[];
	} = {},
): Promise<Fixture> {
	const dir = makeDir();
	const instrument = await writeJson(
		dir,
		"instrument.json",
		overrides.instrument ?? instrumentJson(),
	);
	const replay = await writeJson(dir, "replay-all.json", replayJson());
	const compares =
		overrides.compares === undefined
			? await Promise.all(
					STORIES.map((story) =>
						writeJson(dir, `compare-${story}.json`, compareJson(story)),
					),
				)
			: await Promise.all(
					overrides.compares.map((value, index) =>
						writeJson(dir, `compare-${STORIES[index]}.json`, value),
					),
				);
	const deep = await writeJson(dir, "deep.json", overrides.deep ?? deepJson());
	const preference = await writeJson(
		dir,
		"preference.json",
		overrides.preference ?? preferenceJson(),
	);
	const funnel = await writeJson(dir, "funnel.json", funnelJson());
	const b1 = [await writeJson(dir, "b1-xianxia.json", b1Json())];
	return { dir, instrument, replay, compares, deep, preference, funnel, b1 };
}

function runOptions(fixture: Fixture, now?: () => number) {
	return {
		instrumentPath: fixture.instrument,
		replayPath: fixture.replay,
		comparePaths: fixture.compares,
		deepPath: fixture.deep,
		preferencePath: fixture.preference,
		funnelPath: fixture.funnel,
		b1Paths: fixture.b1,
		log: () => {},
		...(now === undefined ? {} : { now }),
	};
}

function gateOf(report: R6GateRunReport, id: string) {
	const gate = report.gates.gates.find((entry) => entry.id === id);
	if (gate === undefined) throw new Error(`缺少门槛 ${id}`);
	return gate;
}

describe("R6 门槛判定 CLI", () => {
	it("齐全的输入给出 G0–G6 全部通过", async () => {
		const fixture = await writeFixture();
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		expect(report.format).toBe(R6_GATE_FORMAT);
		expect(report.gateVersion).toBe("v2");
		expect(report.gates.passed).toBe(true);
		for (const id of ["G0", "G1", "G2", "G3", "G4", "G5", "G6"]) {
			expect(gateOf(report, id).status).toBe("pass");
		}
		expect(report.funnel?.classes["not-in-prompt"]).toBe(4);
		expect(report.b1?.completedPairs).toBe(28);
		expect(report.b1?.winRate).toBeCloseTo(12 / 21, 6);
	});

	it("G0 未通过时 G1 与 G5 记为仪器无效", async () => {
		const fixture = await writeFixture({
			instrument: instrumentJson({ agreement: 200 }),
		});
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		expect(gateOf(report, "G0").status).toBe("fail");
		expect(gateOf(report, "G1").status).toBe("invalid");
		expect(gateOf(report, "G5").status).toBe("invalid");
		expect(report.gates.invalid).toEqual(["G1", "G5"]);
		expect(report.gates.passed).toBe(false);
	});

	it("深回合工具调用为 0 时 G5 记为不可测", async () => {
		const fixture = await writeFixture({ deep: deepJson({ toolCalls: 0 }) });
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		expect(gateOf(report, "G5").status).toBe("not-measurable");
		expect(report.gates.notMeasurable).toEqual(["G5"]);
		expect(report.gates.passed).toBe(true);
	});

	it("偏好配对不足 30 时 G6 记为样本不足且不计为未通过", async () => {
		const fixture = await writeFixture({
			preference: preferenceJson({ accepted: 5 }),
		});
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		expect(gateOf(report, "G6").status).toBe("insufficient");
		expect(report.gates.insufficient).toEqual(["G6"]);
		expect(report.gates.passed).toBe(true);
	});

	it("重复度差值超过门槛时 G2 未通过", async () => {
		const fixture = await writeFixture({
			compares: STORIES.map((story) =>
				compareJson(story, { repetition: { native: 0.09, naive: 0.05 } }),
			),
		});
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		expect(gateOf(report, "G2").status).toBe("fail");
		expect(gateOf(report, "G2").reason).toContain("差值");
	});

	it("矛盾率超过门槛时 G4 未通过", async () => {
		const fixture = await writeFixture({
			compares: STORIES.map((story) =>
				compareJson(story, {
					probes: { consistent: 5, contradicted: 6, unknown: 0, failed: 0 },
				}),
			),
		});
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		expect(gateOf(report, "G4").status).toBe("fail");
		expect(gateOf(report, "G4").values.contradictionRate).toBeCloseTo(
			18 / 33,
			6,
		);
	});

	it("缺一份输入时失败并指出文件名", async () => {
		const fixture = await writeFixture();
		const missing = path.join(fixture.dir, "missing.json");
		await expect(
			runR6Gate({ ...runOptions(fixture), deepPath: missing }),
		).rejects.toThrow(/missing\.json/);
		await expect(
			runR6Gate({ ...runOptions(fixture), instrumentPath: missing }),
		).rejects.toThrow(/missing\.json/);
		await expect(
			runR6Gate({ ...runOptions(fixture), funnelPath: missing }),
		).rejects.toThrow(/missing\.json/);
		await expect(
			runR6Gate({ ...runOptions(fixture), comparePaths: [] }),
		).rejects.toThrow(/r6-compare/);
	});

	it("没有 B1 结果时报告写明未提供", async () => {
		const fixture = await writeFixture();
		const report = await runR6Gate({
			...runOptions(fixture),
			b1Paths: [],
		});
		expect(report.b1).toBeNull();
		expect(formatR6GateReport(report)).toContain("未提供 B1 结果");
	});

	it("门槛版本不是 v2 时失败并指出文件", async () => {
		const fixture = await writeFixture();
		const stale = await writeJson(fixture.dir, "deep-v1.json", {
			...deepJson(),
			gateVersion: "v1",
		});
		await expect(
			runR6Gate({ ...runOptions(fixture), deepPath: stale }),
		).rejects.toThrow(/deep-v1\.json/);
	});

	it("同一故事缺一个档位时失败并指出故事", async () => {
		const fixture = await writeFixture();
		const partial = await writeJson(fixture.dir, "compare-partial.json", {
			...compareJson("xianxia"),
			profiles: [compareJson("xianxia").profiles[0]],
		});
		await expect(
			runR6Gate({ ...runOptions(fixture), comparePaths: [partial] }),
		).rejects.toThrow(/xianxia 缺少 naive 档/);
	});

	it("CLI 重复运行逐字节相同，且按文件名发现缺省输入", async () => {
		const fixture = await writeFixture();
		await writeJson(fixture.dir, "compare-yuwang.json", compareJson("yuwang"));
		const first = await runR6GateCli({
			dir: fixture.dir,
			instrumentPath: null,
			replayPath: null,
			comparePaths: [],
			deepPath: null,
			preferencePath: null,
			funnelPath: null,
			b1Paths: [],
			jsonPath: null,
			reportPath: null,
			log: () => {},
			now: () => 1_000,
		});
		const jsonPath = path.join(fixture.dir, "gate.json");
		const reportPath = path.join(fixture.dir, "gate.md");
		const firstJson = readFileSync(jsonPath, "utf8");
		const firstReport = readFileSync(reportPath, "utf8");
		expect(first.inputs.compares).toEqual([
			"compare-xianxia.json",
			"compare-yinqi.json",
			"compare-yuwang.json",
		]);
		expect(first.inputs.b1).toEqual(["b1-xianxia.json"]);
		const second = await runR6GateCli({
			dir: fixture.dir,
			instrumentPath: null,
			replayPath: null,
			comparePaths: [],
			deepPath: null,
			preferencePath: null,
			funnelPath: null,
			b1Paths: [],
			jsonPath: null,
			reportPath: null,
			log: () => {},
			now: () => 1_000,
		});
		expect(second.generatedAt).toBe(first.generatedAt);
		expect(readFileSync(jsonPath, "utf8")).toBe(firstJson);
		expect(readFileSync(reportPath, "utf8")).toBe(firstReport);
		expect(firstReport).toContain("# R6 门槛判定");
		expect(firstReport).toContain("## 遗忘漏斗");
		expect(firstReport).not.toContain(fixture.dir);
	});

	it("报告不含运行目录，只写聚合数字与 slug", async () => {
		const fixture = await writeFixture();
		const report = await runR6Gate(runOptions(fixture, () => 1_000));
		const text = formatR6GateReport(report);
		expect(text).not.toContain(fixture.dir);
		expect(text).toContain("|G4|矛盾率|通过|");
		expect(text).toContain("|xianxia|6|1|4|1|");
		expect(text).toContain("改进方向：未进入 prompt");
	});
});
