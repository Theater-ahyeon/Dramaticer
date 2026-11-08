import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	createLlmClient,
	loadChannelsConfig,
	loadDotEnv,
	resolveModelForRole,
} from "@dramaticer/core";
import { expect, test } from "@playwright/test";
import { resolvePlaytestConfig } from "./config";
import { runPlaytest } from "./runner";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");

test.skip(
	process.env.PLAYTEST !== "1",
	"自动试玩用 pnpm playtest 运行，默认跳过",
);

test("界面自动试玩：模型模拟用户、操作排期与两份报告", async ({ page }) => {
	const envPath = join(repoRoot, ".env");
	if (existsSync(envPath) && process.env.PLAYTEST_LIVE === "1") {
		loadDotEnv(envPath);
	}
	const config = resolvePlaytestConfig(process.env);
	test.setTimeout(
		config.rounds * config.roundTimeoutMs + config.backgroundWaitMs,
	);
	const channels = await loadChannelsConfig(
		config.channelsPath,
		config.channelsEnv,
	);
	const writerModel = resolveModelForRole(channels, "writer");
	const backgroundModel = resolveModelForRole(channels, "settler");
	const userClient = createLlmClient(channels, {
		defaultModel: backgroundModel,
		cacheDir: null,
	});
	const result = await runPlaytest(page, {
		config,
		userClient,
		writerModel,
		backgroundModel,
	});
	const rounds = result.records.filter((record) => record.kind === "round");
	const failures = result.records.filter((record) => record.kind === "failure");
	if (failures.length > 0) {
		throw new Error(
			`自动试玩有 ${failures.length} 个失败轮次：${failures
				.map((failure) => failure.stepId)
				.join("、")}`,
		);
	}
	expect(rounds.length).toBe(config.rounds);
	expect(result.preferenceCounts.swipe).toBeGreaterThanOrEqual(
		config.schedule.swipeAt.length,
	);
	expect(result.preferenceCounts.edit).toBeGreaterThanOrEqual(
		config.schedule.editAt.length,
	);
	expect(existsSync(config.privateReportPath)).toBe(true);
	expect(existsSync(config.statsReportPath)).toBe(true);
});
