# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `canon/02`）。原著预估、按章分块抽取、断点续跑与检视器进度完成。
- `core/src/canon/estimate.ts`：按段落切块（每块 ≤2 万字）、token 与费用预估；无单价时用参考费率并在界面说明。
- `core/src/canon/prompt.ts`、`extract.ts`：每块一次调用的 JSON 抽取；块级校验（参与人物在本块原文、段落范围不越界），失败只影响该块；resume 只补未完成块，full 清章重抽并重建名册；别名在写库前归并；插叙单独标出。
- 迁移 77 新增 `canon_extractions`、`canon_chapter_extractions`、`canon_events`、`canon_voices`、`canon_facts`、`canon_entities`；每条内容带 `chapter_ordinal`，合并/拆分后统一同步锚点并丢弃受影响章的抽取结果。
- `server/src/canon-worker.ts` 串行调度；暂停写库、每块之间检查；关闭服务时中止。抽取不写 `background_jobs`，不进每楼预算。
- 接口：预估、开始、暂停、单章重跑、进度（可按章收窄）、检视器总览。页面：原著页顶部预估与进度、章节状态、原文/结果切换；检视器新增「原著抽取」。
- 验证：`pnpm check` 通过（2477 tests）；`v5-canon` 6 条 e2e、`v5-inspector` 2 条通过；`.walk/walk8.spec.ts` 桌面与手机截图已看。

## 下一步
1. `canon/03`：全书汇编（合并别名、排时间线、实体底色与简介、原著故事包）。
2. `canon/04` 起接开局、原著窗口与游标。

## 眼下要注意
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm build`。
- e2e 假渠道的抽取分流靠系统提示词首句「你是原著的事件抽取器」，改提示词要同步 `fake-channel.mjs`。
- 原著抽取的暂停是协作式：正在进行的块会跑完，下一块之前停下；不要改成 abort 当前请求，否则会把块标成失败。
- 合并与拆分现在会清掉受影响章的抽取结果；改章节结构后要在同一个事务里调用 `#syncChapterOrdinals`。
- 迁移版本现在是 77，`assistant-store.test.ts` 的断言要一起改。
