# 依赖登记

每个依赖（包括开发依赖）都要在这里登记：包名用反引号括起来，写清楚它声明在哪个 `package.json`、是运行时还是开发时依赖、以及理由。`scripts/check-invariants.mjs` 会检查（不变量 I3）。

工作区内部依赖（例如 `packages/st-compat` 对 `@dramaticer/core` 的 `workspace:*`）由 pnpm workspace 解析，不需要在这里登记；检查脚本同样跳过以 `workspace:` 开头的版本。

| 依赖 | 位置 | 范围 | 理由 |
|---|---|---|---|
| `typescript` | 根目录 | dev | 类型检查与编译 |
| `vitest` | 根目录 | dev | 测试 |
| `@biomejs/biome` | 根目录 | dev | lint 与格式化 |
| `@types/node` | 根目录 | dev | Node 类型 |
| `better-sqlite3` | `packages/core` | runtime | SQLite 与 FTS5（ADR-0001） |
| `better-sqlite3` | `packages/st-compat` | runtime | ACU 对照组在内存 SQLite 里重放表格更新 |
| `@types/better-sqlite3` | `packages/core`、`packages/st-compat` | dev | 类型 |
| `@earendil-works/pi-ai` | 根目录 | dev | M1-T01 验证统一模型层（流式、思考、函数调用、自定义 baseUrl）；M1-T02 采用后移到 `packages/core` 的运行时依赖（ADR-0009） |
| `@earendil-works/pi-agent-core` | 根目录 | dev | M1-T01 验证无状态单轮执行器与 `prepareRequest`、`beforeToolCall`、`finishTurn` 钩子；M1-T02 采用后移到 `packages/core` 的运行时依赖（ADR-0009） |
| `png-chunks-extract` | `packages/st-compat` | runtime | 解析角色卡 PNG 的块（ADR-0003） |
| `png-chunks-extract` | 根目录 | dev | `scripts/snapshot-private-data.mjs` 从角色卡提取世界书引用（ADR-0003） |
| `png-chunk-text` | `packages/st-compat` | runtime | 解码角色卡 PNG 的 tEXt 文本块（ADR-0003） |
| `png-chunk-text` | 根目录 | dev | 快照脚本读取角色卡 PNG（ADR-0003） |
