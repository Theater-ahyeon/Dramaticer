import { configDefaults, defineConfig } from "vitest/config";

// 评测、裁判、试玩与门槛判定的测试（st-compat 的 evalset）占了整仓测试时间的大头，
// 而产品功能不依赖它们：默认门禁只跑 unit，需要评测时再跑 `pnpm test:eval`。
// 兼容插件的共存验收（*-coexist）虽然也用到 evalset，但它是插件自己的验收标准（I15），留在 unit。
const evalTests = [
	"acu",
	"benchmark",
	"deep-eval",
	"director-eval",
	"event-cli",
	"events-backfill",
	"forgetting-eval",
	"fusion-weights",
	"gap-pass-compare",
	"gates",
	"historical-replay",
	"memory-eval",
	"memory-judged",
	"memory-questions",
	"metrics",
	"opening-eval",
	"pairwise",
	"playtest",
	"probe",
	"question-files",
	"r6-b1",
	"r6-compare",
	"r6-deep",
	"r6-funnel",
	"r6-gate",
	"r6-instrument",
	"r6-preference",
	"r6-replay",
	"retrieval",
	"scene-log-compare-batch",
	"scoreboard",
	"state-cli",
	"turn-mode-compare",
].map((name) => `packages/st-compat/test/${name}.test.ts`);

export default defineConfig({
	test: {
		// 实现用的 worktree 在 .worktrees/ 下，各自有完整测试；主工作区的整仓测试跳过它们。
		exclude: [
			...configDefaults.exclude,
			"packages/web/e2e/**",
			// 本机走查截图脚本（Playwright，不入库）。
			"packages/web/.walk/**",
			"**/.worktrees/**",
		],
		// Windows 上并行跑整个仓库时，单个文件与文件系统、数据库的测试会比单独运行慢十几倍；
		// 本机临时目录被扫描拖慢，r6-compare 与 world-model-compare 单跑也要四五分钟。
		testTimeout: 300_000,
		// 每个 worker 都在临时目录里建 SQLite 库，24 核全开会让磁盘与杀毒扫描互相排队，
		// 单文件耗时涨到单独运行的几十倍并触发超时；限制 worker 数量让总耗时与失败率都更稳定
		maxWorkers: 8,
		projects: [
			{ extends: true, test: { name: "unit", exclude: evalTests } },
			{ extends: true, test: { name: "eval", include: evalTests } },
		],
	},
});
