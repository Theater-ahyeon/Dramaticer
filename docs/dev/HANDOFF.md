# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：2
- 任务：M0-T01 仓库与工程骨架（本会话以修复门禁开始）
- 结果：完成。补齐了 `packages/st-compat` 的 `src/index.ts`、`tsconfig.json`、示例测试和依赖登记，安装了依赖，`pnpm check` 全部通过。

## 当前状态
- 门禁：`pnpm check` 通过。顺序是 invariants → typecheck（`tsc -b`）→ lint（`biome check .`）→ test（`vitest run`），当前 2 个测试。
- 工程骨架：
  - 根目录有 `package.json`（ESM，Node ≥ 22.19，pnpm 10.32.1）、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.json`（项目引用）、`biome.json`、`.gitignore`、`.env.example`。
  - `packages/core` 与 `packages/st-compat` 各有 `package.json`、`tsconfig.json`（st-compat 引用 ../core）、`src/index.ts`、`test/index.test.ts`。
  - `st-compat` 通过 `"@dramaticer/core": "workspace:*"` 依赖 core，测试验证了工作区解析。
- 工具链细节：
  - `biome.json` 的格式化规则是 tab 缩进，JSON 文件也被格式化；新增的 JSON 若用空格缩进，`pnpm check` 会失败，可以用 `pnpm exec biome check --write .` 修正。
  - `*.tsbuildinfo` 已加入 `.gitignore`；`tsc -b` 会在各包目录生成该文件。
  - `pnpm install` 会提示 `@biomejs/biome`、`esbuild` 的构建脚本被忽略；实测不影响 lint 和测试。
- 依赖登记在 `docs/dev/DEPENDENCIES.md`，其中已经预留了 `better-sqlite3` 与 `@types/better-sqlite3`，但尚未安装。

## 下一步
- 执行 M0-T02（私有数据快照脚本）
  - 写 `scripts/snapshot-private-data.mjs`：从 `DRAMATICER_ST_ROOT`（默认 `D:\SillyTavern\TauriTavern\default-user\`）只读复制 3 个对话 jsonl、角色卡、世界书、`OpenAI Settings/` 到 `eval-private/raw/`
  - 生成 `eval-private/raw/manifest.json`，记录源路径、大小、sha256
  - 验收：文件齐全、manifest 完整、源目录只读、`git status` 看不到 `eval-private`

## 注意事项
- 私有数据只在给自己看的报告里引用；提交进仓库的内容只能有统计数字。
- 单个 jsonl 可能有几十 MB，必须流式处理，不要整个读进上下文。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
