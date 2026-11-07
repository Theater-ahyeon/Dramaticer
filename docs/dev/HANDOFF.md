# 交接

> 每个会话结束前都要**完整重写**这个文件（不是往后追加），按下面的模板填写。

## 最近一次会话
- 会话：3
- 任务：M0-T02 私有数据快照脚本
- 结果：完成。`scripts/snapshot-private-data.mjs` 从 ST 数据根只读复制 3 个对话、3 张角色卡、3 本世界书和 58 个预设到 `eval-private/raw/`，生成带源路径、大小、sha256 的 `manifest.json`；逐文件核对源与目标的 sha256 一致。

## 当前状态
- 门禁：`pnpm check` 通过。顺序是 invariants → typecheck（`tsc -b`）→ lint（`biome check .`）→ test（`vitest run`），当前 2 个测试。
- 快照产物：`eval-private/raw/` 共 67 个数据文件加 `manifest.json`，约 137.09 MB。目录结构是 `chats/<角色>/`、`cards/`、`worlds/`、`presets/`。`eval-private/` 已被 git 忽略，`git status` 看不到。
- 快照脚本：`node scripts/snapshot-private-data.mjs`，也可以运行 `pnpm snapshot`。源根由 `DRAMATICER_ST_ROOT` 指定，默认 `D:\SillyTavern\TauriTavern\default-user\`。
  - 对话目录按名称选择：「仙侠雌竞」前缀、「银麒赎世」、「欲望世界-1600」；每个目录取最大的 `.jsonl`。
  - 角色卡优先取同名 `.png`，没有就取 `.json`；PNG 的 `chara`/`ccv3` 文本块用 `png-chunks-extract` 加 `png-chunk-text` 解析。
  - 世界书从卡的 `data.extensions.world` 或 `data.character_book.name` 推断，优先精确匹配 `worlds/<名字>.json`，再尝试唯一的前缀匹配。
  - `OpenAI Settings/` 递归复制全部文件。
  - manifest 的每一条记录 `role`、`character`（适用时）、`source`、`target`、`size`、`sha256`。
- 工具链细节：
  - `biome.json` 的格式化规则是 tab 缩进，JSON 文件也被格式化；`scripts/**` 与 `eval-private/**` 被 lint 忽略。
  - `*.tsbuildinfo` 已加入 `.gitignore`。
  - 新增依赖 `png-chunks-extract`、`png-chunk-text`（ADR-0003，已登记在 DEPENDENCIES.md）。
- 本次没有改动任何设计不变量；快照脚本只读源目录，私有数据没有进入 git。

## 下一步
- 执行 M0-T03（st-compat：聊天 jsonl 解析）
  - 实现流式逐行解析，单个文件最大 35 MB，每行可能超过 100 KB。
  - 解析头部（character_name、user_name、chat_metadata 原样保留）和每条消息的 `name`、`is_user`、`is_system`、`send_date`、`mes`、`swipes`、`swipe_id`、`extra.reasoning`、`variables`；不认识的字段放进 `raw`。
  - 验收用合成数据覆盖 swipe、system 消息、缺字段和超长行。

## 注意事项
- 私有数据只在给自己看的报告里引用；提交进仓库的内容只能有统计数字。
- `eval-private/raw/chats/` 里的单个 jsonl 可能有几十 MB，必须流式处理，不要整个读进上下文。
- `.env` 已由人类填写，**不要覆盖**；`.env.example` 只列变量名。
- 后台渠道（magpie 本地网关，`antigravity/gemini-3.8-flash`）实测即使 `max_tokens=20` 也会产生约 750 个思考 token；M0-T11 的客户端要支持思考档位并统计思考 token。
