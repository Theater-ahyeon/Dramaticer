# 归档的一次性脚本

F0 取证、R1/R2 评测与 R5 试玩阶段写的一次性脚本，结论已经写进当时的报告与 ADR，产品运行不依赖它们。
保留在这里只为可复现；`package.json` 不再给它们起命令名。需要时在仓库根目录直接运行，例如：

```sh
pnpm build
node scripts/archive/f0-corpus.mjs
```

它们读写 `eval-private/` 与 `docs/dev/reports/`，只能在作者本机、有私有数据时运行。
