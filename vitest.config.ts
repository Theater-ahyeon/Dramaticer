import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: [...configDefaults.exclude, "packages/web/e2e/**"],
		// Windows 上并行跑整个仓库时，单个文件与文件系统、数据库的测试会比单独运行慢十几倍
		testTimeout: 60_000,
		// 每个 worker 都在临时目录里建 SQLite 库，24 核全开会让磁盘与杀毒扫描互相排队，
		// 单文件耗时涨到单独运行的几十倍并触发超时；限制 worker 数量让总耗时与失败率都更稳定
		maxWorkers: 8,
	},
});
