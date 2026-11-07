# 依赖登记

每个依赖（包括开发依赖）都要在这里登记一行：包名用反引号括起来，并写清楚理由。`scripts/check-invariants.mjs` 会检查（不变量 I3）。

| 依赖 | 范围 | 理由 |
|---|---|---|
| `typescript` | dev | 类型检查 |
| `vitest` | dev | 测试 |
| `@biomejs/biome` | dev | lint 与格式化 |
| `@types/node` | dev | Node 类型 |
| `better-sqlite3` | runtime | SQLite 与 FTS5（ADR-0001） |
| `@types/better-sqlite3` | dev | 类型 |
