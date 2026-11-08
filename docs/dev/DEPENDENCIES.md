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
| `@earendil-works/pi-ai` | `packages/core` | runtime | 模型层：流式生成、思考内容、用量与中止（ADR-0009） |
| `@earendil-works/pi-ai` | 根目录 | dev | `spikes/pi/` 的验证脚本使用（ADR-0009） |
| `@earendil-works/pi-agent-core` | 根目录 | dev | `spikes/pi/` 验证钩子使用；运行时执行器由 `packages/core` 自己实现（ADR-0022） |
| `yaml` | `packages/core` | runtime | 解析 `data/channels.yaml` 渠道配置 |
| `sqlite-vec` | `packages/core` | runtime | 块向量的 vec0 虚拟表与 KNN 检索（DESIGN §13） |
| `png-chunks-extract` | `packages/st-compat` | runtime | 解析角色卡 PNG 的块（ADR-0003） |
| `png-chunks-extract` | 根目录 | dev | `scripts/snapshot-private-data.mjs` 从角色卡提取世界书引用（ADR-0003） |
| `png-chunk-text` | `packages/st-compat` | runtime | 解码角色卡 PNG 的 tEXt 文本块（ADR-0003） |
| `png-chunk-text` | 根目录 | dev | 快照脚本读取角色卡 PNG（ADR-0003） |
| `react` | `packages/web` | runtime | 界面组件（DESIGN §13） |
| `react-dom` | `packages/web` | runtime | 浏览器渲染 |
| `react-router-dom` | `packages/web` | runtime | 页面路由 |
| `vite` | `packages/web` | dev | 开发服务器与前端构建（DESIGN §13） |
| `@vitejs/plugin-react` | `packages/web` | dev | JSX 转换 |
| `@types/react` | `packages/web` | dev | React 类型 |
| `@types/react-dom` | `packages/web` | dev | React DOM 类型 |
