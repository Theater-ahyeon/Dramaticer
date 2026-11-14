import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	StoryStore as StoryStoreClass,
	type TimelineNode,
} from "@dramaticer/core";
import { afterEach, describe, expect, it } from "vitest";
import type {
	PlaytestProbeRecord,
	ProbeContextSegment,
	ProbeFact,
} from "../src/evalset/probe.js";
import { runR6FunnelCli } from "../src/evalset/r6-funnel-cli.js";
import {
	type R6FunnelReport,
	R6_FUNNEL_FORMAT,
	attributeContradictedProbe,
	formatR6FunnelReport,
	r6FunnelDirection,
	runR6Funnel,
} from "../src/evalset/r6-funnel.js";

const STORY = "funnel-story";
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
	const dir = mkdtempSync(path.join(import.meta.dirname, ".tmp-funnel-"));
	createdDirs.push(dir);
	return dir;
}

function seedStory(store: InstanceType<typeof StoryStoreClass>): TimelineNode {
	store.createStory({ id: STORY, title: "遗忘漏斗测试" });
	let parentId: string | null = null;
	let last: TimelineNode | null = null;
	for (let index = 0; index < 8; index += 1) {
		last = store.appendNode({
			storyId: STORY,
			parentId,
			role: index % 2 === 0 ? "assistant" : "user",
			raw:
				index === 2
					? "山门在东方，卫宫守在山门口。"
					: index === 4
						? "夜里起雾，剑客把信物收进袖中。"
						: `第 ${index + 1} 楼：风停了。`,
		});
		parentId = last.id;
	}
	if (last === null) throw new Error("没有建出楼层");
	return last;
}

function stateSegment(snapshot: string): ProbeContextSegment {
	return {
		segmentId: "state",
		slot: "state",
		source: "state:6 条 diff",
		text: `当前状态：\n${snapshot}`,
	};
}

function probeRecord(input: {
	readonly round: number;
	readonly nodeId: string;
	readonly fact: ProbeFact;
	readonly context: readonly ProbeContextSegment[];
	readonly reason: string;
}): PlaytestProbeRecord {
	return {
		status: "done",
		round: input.round,
		nodeId: input.nodeId,
		fact: input.fact,
		context: input.context,
		question: "请回忆：角色「卫宫」的所在位置是什么？",
		answer: "山门在南边。",
		verdict: "contradicted",
		reason: input.reason,
		judgeAttempts: 1,
		error: null,
		answerUsage: null,
		judgeUsage: null,
	};
}

interface SeededRun {
	readonly dir: string;
	readonly floor: number;
	readonly probes: readonly PlaytestProbeRecord[];
	readonly evidenceNodeId: string;
	readonly missingEvidenceNodeId: string;
	readonly headNodeId: string;
}

/**
 * 三层矛盾探针各一条：有原文支撑且进入 prompt、有原文支撑但没进 prompt、
 * 台账事实在原文里找不到支撑。运行目录与 r6-compare 同构。
 */
async function seedRun(dir: string): Promise<SeededRun> {
	const floor = 3;
	const runDir = path.join(dir, "runs", STORY, String(floor));
	await mkdir(runDir, { recursive: true });
	const dbPath = path.join(runDir, "native.db");
	const store = StoryStoreClass.open(dbPath);
	let headNodeId: string;
	let evidenceNodeId: string;
	let atmosphereNodeId: string;
	let missingEvidenceNodeId: string;
	let probes: PlaytestProbeRecord[];
	try {
		headNodeId = seedStory(store).id;
		const path = store.getPathToHead(STORY);
		evidenceNodeId = path[2]?.id as string;
		atmosphereNodeId = path[4]?.id as string;
		missingEvidenceNodeId = path[6]?.id as string;
		store.appendStateDiffs([
			{
				storyId: STORY,
				nodeId: evidenceNodeId,
				path: ["character", "卫宫", "location"],
				op: "set",
				value: "山门",
				source: "model",
			},
			{
				storyId: STORY,
				nodeId: atmosphereNodeId,
				path: ["scene", "current", "atmosphere"],
				op: "set",
				value: "夜里起雾",
				source: "model",
			},
			{
				storyId: STORY,
				nodeId: missingEvidenceNodeId,
				path: ["character", "卫宫", "identity"],
				op: "set",
				value: "隐姓埋名的剑客",
				source: "settler",
			},
		]);
		const snapshot = JSON.stringify(store.getStateSnapshot(headNodeId).state);
		probes = [
			probeRecord({
				round: 6,
				nodeId: headNodeId,
				fact: {
					path: ["character", "卫宫", "location"],
					nodeId: evidenceNodeId,
					ageFloors: 6,
					value: "山门",
				},
				context: [stateSegment(snapshot)],
				reason: "回答与台账矛盾",
			}),
			probeRecord({
				round: 12,
				nodeId: headNodeId,
				fact: {
					path: ["scene", "current", "atmosphere"],
					nodeId: atmosphereNodeId,
					ageFloors: 4,
					value: "夜里起雾",
				},
				context: [
					{
						segmentId: "history",
						slot: "history",
						source: "history:最近 2 楼",
						text: "第 7 楼：风停了。",
					},
				],
				reason: "回答里没有雾",
			}),
			probeRecord({
				round: 18,
				nodeId: headNodeId,
				fact: {
					path: ["character", "卫宫", "identity"],
					nodeId: missingEvidenceNodeId,
					ageFloors: 2,
					value: "隐姓埋名的剑客",
				},
				context: [stateSegment(snapshot)],
				reason: "回答与身份不符",
			}),
		];
	} finally {
		store.close();
	}
	await writeFile(
		path.join(runDir, "native.json"),
		`${JSON.stringify(
			{
				format: "dramaticer.r6-compare-run",
				story: STORY,
				branchFloor: floor,
				records: probes.map((probe) => ({ round: probe.round, probe })),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return {
		dir,
		floor,
		probes,
		evidenceNodeId,
		missingEvidenceNodeId,
		headNodeId,
	};
}

describe("r6-funnel", () => {
	it("三步归因互斥：无依据、未进入 prompt、进入 prompt 未答对", async () => {
		const dir = makeDir();
		const seeded = await seedRun(dir);
		const before = createHash("sha256")
			.update(readFileSync(path.join(dir, "runs", STORY, "3", "native.db")))
			.digest("hex");
		const store = StoryStoreClass.open(
			path.join(dir, "runs", STORY, "3", "native.db"),
		);
		try {
			const classes = seeded.probes.map((probe) => {
				const attribution = attributeContradictedProbe({
					store,
					story: STORY,
					floor: seeded.floor,
					probe,
				});
				if (attribution === null) throw new Error("没有归因结果");
				return attribution;
			});
			expect(classes.map((item) => item.class)).toEqual([
				"not-recalled",
				"not-in-prompt",
				"no-evidence",
			]);
			expect(classes[0]?.evidence).toBe("exact");
			expect(classes[0]?.ledgerSegmentId).toBe("state");
			expect(classes[1]?.ledgerSegmentId).toBeNull();
			expect(classes[2]?.evidence).toBe("none");
			expect(classes[2]?.evidenceCoverage).toBe(0);
		} finally {
			store.close();
		}
		const after = createHash("sha256")
			.update(readFileSync(path.join(dir, "runs", STORY, "3", "native.db")))
			.digest("hex");
		expect(after).toBe(before);
	});

	it("汇总按故事给出三类条数与改进方向，报告不含台账路径与原文", async () => {
		const dir = makeDir();
		await seedRun(dir);
		const report = await runR6Funnel({
			dirs: [dir],
			now: () => Date.parse("2026-11-14T00:00:00.000Z"),
		});
		expect(report.format).toBe(R6_FUNNEL_FORMAT);
		expect(report.generatedAt).toBe("2026-11-14T00:00:00.000Z");
		expect(report.summary.contradicted).toBe(3);
		expect(report.summary.classes).toEqual({
			"no-evidence": 1,
			"not-in-prompt": 1,
			"not-recalled": 1,
		});
		expect(report.summary.unattributed).toBe(0);
		expect(report.summary.stories).toHaveLength(1);
		expect(report.summary.stories[0]?.contradicted).toBe(3);
		expect(report.attributions.map((item) => item.round)).toEqual([6, 12, 18]);
		const text = formatR6FunnelReport(report);
		expect(text).toContain("无依据");
		expect(text).toContain("未进入 prompt");
		expect(text).toContain("进入 prompt 未答对");
		expect(text).toContain(`|${STORY}|`);
		expect(text).not.toContain("卫宫");
		expect(text).not.toContain("山门");
		expect(text).not.toContain("隐姓埋名");
		expect(text).not.toContain("回答与台账矛盾");
	});

	it("只有矛盾探针进入漏斗，一致与失败的探针不计", async () => {
		const dir = makeDir();
		const seeded = await seedRun(dir);
		const file = path.join(dir, "runs", STORY, "3", "native.json");
		const sidecar = JSON.parse(readFileSync(file, "utf8")) as {
			records: { round: number; probe: PlaytestProbeRecord }[];
		};
		sidecar.records.push({
			round: 24,
			probe: {
				...seeded.probes[0],
				round: 24,
				verdict: "consistent",
			} as PlaytestProbeRecord,
		});
		sidecar.records.push({
			round: 30,
			probe: {
				...seeded.probes[0],
				round: 30,
				status: "failed",
				verdict: null,
				error: "裁判连续 3 次没有输出合法的 {consistent, reason}",
			} as PlaytestProbeRecord,
		});
		await writeFile(file, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
		const report = await runR6Funnel({ dirs: [dir] });
		expect(report.summary.contradicted).toBe(3);
		expect(report.attributions.map((item) => item.round)).toEqual([6, 12, 18]);
	});

	it("探针记录没有上下文段时记为无法归因，不猜测分类", async () => {
		const dir = makeDir();
		const seeded = await seedRun(dir);
		const file = path.join(dir, "runs", STORY, "3", "native.json");
		const sidecar = JSON.parse(readFileSync(file, "utf8")) as {
			records: { round: number; probe: Record<string, unknown> }[];
		};
		const stripped = sidecar.records.map((record) => {
			const { context: _context, ...rest } = record.probe;
			return { round: record.round, probe: rest };
		});
		await writeFile(
			file,
			`${JSON.stringify({ ...sidecar, records: stripped }, null, 2)}\n`,
			"utf8",
		);
		const report = await runR6Funnel({ dirs: [dir] });
		expect(report.summary.contradicted).toBe(0);
		expect(report.summary.unattributed).toBe(seeded.probes.length);
		expect(report.summary.classes).toEqual({
			"no-evidence": 0,
			"not-in-prompt": 0,
			"not-recalled": 0,
		});
		expect(r6FunnelDirection(report.summary)).toBeNull();
	});

	it("改进方向取占比最大的一类", async () => {
		const dir = makeDir();
		const seeded = await seedRun(dir);
		const file = path.join(dir, "runs", STORY, "3", "native.json");
		const sidecar = JSON.parse(readFileSync(file, "utf8")) as {
			records: { round: number; probe: PlaytestProbeRecord }[];
		};
		sidecar.records.push({
			round: 36,
			probe: { ...seeded.probes[2], round: 36 },
		});
		await writeFile(file, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
		const report = await runR6Funnel({ dirs: [dir] });
		expect(report.summary.classes["no-evidence"]).toBe(2);
		expect(r6FunnelDirection(report.summary)).toBe("no-evidence");
	});

	it("CLI 写出结果 JSON 与只含聚合数字的报告", async () => {
		const dir = makeDir();
		await seedRun(dir);
		const out = path.join(dir, "out");
		const report = await runR6FunnelCli({
			dirs: [dir],
			jsonPath: path.join(out, "funnel.json"),
			reportPath: path.join(out, "funnel.md"),
			log: () => undefined,
			now: () => Date.parse("2026-11-14T00:00:00.000Z"),
		});
		const json = JSON.parse(
			readFileSync(path.join(out, "funnel.json"), "utf8"),
		) as R6FunnelReport;
		expect(json.summary).toEqual(report.summary);
		const markdown = readFileSync(path.join(out, "funnel.md"), "utf8");
		expect(markdown).toContain("R6 遗忘漏斗诊断");
		expect(markdown).not.toContain("卫宫");
	});

	it("运行目录缺少 runs 时直接失败并指出路径", async () => {
		const dir = makeDir();
		await expect(runR6Funnel({ dirs: [dir] })).rejects.toThrow(
			/运行目录里没有 runs/,
		);
	});
});
