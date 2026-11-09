import { join, resolve } from "node:path";
import type { PlaytestScheduleView } from "../../src/playtest/records";

export interface PlaytestConfig {
	readonly live: boolean;
	readonly rounds: number;
	readonly schedule: PlaytestScheduleView;
	readonly password: string;
	readonly channelsPath: string;
	readonly channelsEnv: Readonly<Record<string, string | undefined>>;
	readonly dbPath: string;
	readonly privateReportPath: string;
	readonly statsReportPath: string;
	readonly screenshotDir: string;
	readonly storyTitle: string;
	readonly backgroundWaitMs: number;
	readonly roundTimeoutMs: number;
	readonly resume: boolean;
	readonly progressPath: string;
	readonly timeBudgetMs: number;
}

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

export function resolvePlaytestConfig(
	env: Readonly<Record<string, string | undefined>> = process.env,
): PlaytestConfig {
	const live = env.PLAYTEST_LIVE === "1";
	const rounds = readInteger(
		env.PLAYTEST_ROUNDS,
		live ? 60 : 5,
		"PLAYTEST_ROUNDS",
	);
	if (rounds < 2) {
		throw new Error(`试玩轮数至少为 2：${rounds}`);
	}
	const schedule = readSchedule(env, rounds);
	assertSchedule(schedule, rounds);
	return {
		live,
		rounds,
		schedule,
		password:
			env.PLAYTEST_PASSWORD ??
			(live ? (env.DRAMATICER_SERVER_PASSWORD ?? "") : "e2e-password"),
		channelsPath: resolve(
			repoRoot,
			env.PLAYTEST_CHANNELS ??
				(live
					? join("data", "channels.yaml")
					: join(".devloop", "scratch", "e2e", "work", "channels.yaml")),
		),
		channelsEnv: live ? env : { E2E_FAKE_KEY: env.E2E_FAKE_KEY ?? "e2e-key" },
		dbPath: resolve(
			repoRoot,
			env.PLAYTEST_DB ??
				(live
					? join("data", "dramaticer.db")
					: join(".devloop", "scratch", "e2e", "work", "e2e.db")),
		),
		privateReportPath: resolve(
			repoRoot,
			env.PLAYTEST_PRIVATE_REPORT ??
				(live
					? join("eval-private", "reports", "r5-playtest.md")
					: join(
							".devloop",
							"scratch",
							"e2e",
							"playtest",
							"private-r5-playtest.md",
						)),
		),
		statsReportPath: resolve(
			repoRoot,
			env.PLAYTEST_STATS_REPORT ??
				(live
					? join("docs", "dev", "reports", "R5-playtest.md")
					: join(
							".devloop",
							"scratch",
							"e2e",
							"playtest",
							"stats-R5-playtest.md",
						)),
		),
		screenshotDir: resolve(
			repoRoot,
			env.PLAYTEST_SCREENSHOT_DIR ??
				join(".devloop", "scratch", "e2e", "playtest", "screenshots"),
		),
		storyTitle: env.PLAYTEST_STORY_TITLE ?? "自动试玩",
		backgroundWaitMs: readInteger(
			env.PLAYTEST_BACKGROUND_WAIT_MS,
			60_000,
			"PLAYTEST_BACKGROUND_WAIT_MS",
		),
		roundTimeoutMs: readInteger(
			env.PLAYTEST_ROUND_TIMEOUT_MS,
			180_000,
			"PLAYTEST_ROUND_TIMEOUT_MS",
		),
		resume: readBoolean(env.PLAYTEST_RESUME, live, "PLAYTEST_RESUME"),
		progressPath: resolve(
			repoRoot,
			env.PLAYTEST_PROGRESS ??
				(live
					? join("eval-private", "reports", "r5-playtest.progress.json")
					: join(
							".devloop",
							"scratch",
							"e2e",
							"playtest",
							"progress-r5-playtest.json",
						)),
		),
		timeBudgetMs: readInteger(
			env.PLAYTEST_TIME_BUDGET_MS,
			live ? 45 * 60_000 : 0,
			"PLAYTEST_TIME_BUDGET_MS",
		),
	};
}

/**
 * 60 轮默认排期保证至少两次重新生成、两次编辑、两次分支切换；
 * 短跑按同样的相对位置缩放，让冒烟也覆盖三种操作。
 */
export function defaultSchedule(rounds: number): PlaytestScheduleView {
	if (rounds >= 12) {
		return {
			swipeAt: [3, 7],
			editAt: [4, 8],
			branchAt: [5, 9],
			candidateAt: [2, 6],
			optionAt: [6, 10],
		};
	}
	return {
		swipeAt: [2],
		editAt: [3],
		branchAt: [Math.min(4, rounds)],
		candidateAt: [Math.min(2, rounds)],
		optionAt: [Math.min(3, rounds)],
	};
}

export function assertSchedule(
	schedule: PlaytestScheduleView,
	rounds: number,
): void {
	const entries: readonly [string, readonly number[]][] = [
		["swipeAt", schedule.swipeAt],
		["editAt", schedule.editAt],
		["branchAt", schedule.branchAt],
		["candidateAt", schedule.candidateAt],
		["optionAt", schedule.optionAt],
	];
	for (const [name, values] of entries) {
		for (const value of values) {
			if (!Number.isInteger(value) || value < 1 || value > rounds) {
				throw new Error(
					`排期 ${name} 的轮次必须在 1 到 ${rounds} 之间：${value}`,
				);
			}
		}
		if (new Set(values).size !== values.length) {
			throw new Error(`排期 ${name} 有重复轮次`);
		}
	}
	if (rounds >= 60) {
		for (const [name, values] of [
			["swipeAt", schedule.swipeAt],
			["editAt", schedule.editAt],
			["branchAt", schedule.branchAt],
		] as const) {
			if (values.length < 2) {
				throw new Error(`60 轮试玩的排期 ${name} 至少要两次`);
			}
		}
	}
	if (schedule.branchAt.length > 0 && schedule.editAt.length === 0) {
		throw new Error("分支切换需要先编辑出一个兄弟分支");
	}
	const earliestEdit = Math.min(...schedule.editAt);
	for (const round of schedule.branchAt) {
		if (round <= earliestEdit) {
			throw new Error(
				`分支切换第 ${round} 轮之前没有可切换的编辑分支（最早编辑在第 ${earliestEdit} 轮）`,
			);
		}
	}
}

function readSchedule(
	env: Readonly<Record<string, string | undefined>>,
	rounds: number,
): PlaytestScheduleView {
	const fallback = defaultSchedule(rounds);
	return {
		swipeAt: readRounds(env.PLAYTEST_SWIPE_AT, fallback.swipeAt),
		editAt: readRounds(env.PLAYTEST_EDIT_AT, fallback.editAt),
		branchAt: readRounds(env.PLAYTEST_BRANCH_AT, fallback.branchAt),
		candidateAt: readRounds(env.PLAYTEST_CANDIDATE_AT, fallback.candidateAt),
		optionAt: readRounds(env.PLAYTEST_OPTION_AT, fallback.optionAt),
	};
}

function readRounds(
	value: string | undefined,
	fallback: readonly number[],
): number[] {
	if (value === undefined) return [...fallback];
	const text = value.trim();
	if (text.length === 0) return [];
	return text.split(",").map((part) => readInteger(part.trim(), 0, "排期"));
}

function readInteger(
	value: string | undefined,
	fallback: number,
	name: string,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${name} 必须是非负整数：${value}`);
	}
	return parsed;
}

function readBoolean(
	value: string | undefined,
	fallback: boolean,
	name: string,
): boolean {
	if (value === undefined) return fallback;
	if (value === "1") return true;
	if (value === "0") return false;
	throw new Error(`${name} 只能是 0 或 1：${value}`);
}
