import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: [...configDefaults.exclude, "packages/web/e2e/**"],
		// Windows 上并行跑整个仓库时，单个文件与文件系统、数据库的测试会比单独运行慢十几倍
		testTimeout: 60_000,
	},
});
