# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-19（人工会话，连续推进）。人类要求：把 `spec/v4-remaining` 合进 `main`，做完剩余工单，最后整理推送并写详尽 README。
  - `ui-lite` 01–06 全部完成（纸与墨设计系统、阅读体验、页面统一、旧面板、体积预算与可访问性）。
  - `refactor/02`：文风层、状态面板接通；本轮临时开关进回合请求 `features` 与输入台「本轮」面板（ADR-0164）。
  - `refactor/03`：后台岗位跨供应商保底 `fallback`、配置提醒、后台暂停提示、按岗位体检（ADR-0165）。
  - `refactor/04`：北极星指标 `dramaticer stats rerolls` 与设置页「重写率」表。
  - `refactor/05`：`StoryStore` 拆成 `core/src/store/repos/` 15 个领域仓储，外观委托，调用方零改动。
  - `refactor/06`：server 路由拆成 `routes-<领域>.ts`，共用校验在 `routes-common.ts`。
  - `refactor/08`：删除 `wiki`、`temporal_graph` 世界模型与 `bits` 小品引擎（ADR-0166）；`mechanisms` 暂留。
  - `refactor/07` 暂缓：人类说「暂时不用评测」，评测工具与 health/reference 纠缠，见工单 Comments。
  - 根目录新增 `README.md`。修好 `e2e/ledger.spec.ts` 的不稳定（等后台抽取时重新加载）。
- 门禁：`pnpm check` 2832 通过；`pnpm e2e` 79 通过（3 个跳过：2 个实时试玩、手机上的键盘用例）。

## 下一步
1. 作者本人用真实大卡连续试玩 2–3 个故事，用 `stats rerolls` 拿北极星数字（MVP 第 6 条）。
2. 有了数字后另开工单删除 `mechanisms`（连同插件机制注册表一起决定）。
3. 需要评测时做 `refactor/07`。
4. 选定开源许可证（README 里写明尚未选定）。

## 眼下要注意
- 远端：`origin` = GitHub 公开仓库 Theater-ahyeon/Dramaticer，只推 `main`。推送前历史的作者邮箱已按人类要求换成 GitHub 隐私邮箱，本仓库 `user.email` 也已改成隐私邮箱；改写前的旧 `main` 留在本地分支 `backup/main-original`（不要推）。旧的 `spec/*`、`ticket/*` 分支仍是旧邮箱，不要推。
- 新存储方法：写进对应领域仓储，再把名字加进 `story-store.ts` 的 `Pick<…>` 与 `DELEGATES`。
- 新路由：参数校验只用 `routes-common.ts`。
- server 读 core 的 `dist`：改了 core 导出后先 `pnpm --filter @dramaticer/core run build`；单跑 e2e 前先构建 web 与 server。
- 已有故事保存的 `directorOrganization` 仍可能是 `mechanisms`；`bits` 与已删世界模型的旧值按默认运行，Trace 来源注明。
- 人类的 `data/channels.yaml` 还没配后台保底，启动日志会提醒（HUMAN-19 已写配置方法）。
