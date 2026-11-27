# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `canon/03`）。全书汇编、实体底色与世界索引、原著故事包导出导入完成。
- 迁移 78：`canon_books.has_text`、`canon_compilations`、`canon_compiled_entities`、`canon_events.timeline_order/is_turning_point`。
- `core/src/canon/compile.ts`：一次后台任务分三步——合并同名与别名（程序 + 模型确认）、排主时间线并标关键转折、分批生成实体页（一行简介 + 带章节锚点的底色）。事实/事件/话术的章节一起算进实体出现范围；插叙不进主线。
- 纯函数 `sliceCanonEntityPage`、`buildCanonStartingPages`、`renderCanonWorldIndex`：按 `upToChapter` 切片，供 `canon/04`、`canon/05` 直接用。
- `core/src/canon/package.ts`：`dramaticer-canon-package` v1；默认不含原文；导入按章序号重建，直接是 extracted + 汇编 done，0 次模型调用。
- `server/src/canon-worker.ts` 队列加 `kind: compile`；接口 `POST .../compile`、`GET .../compiled[?upToChapter=]`、`GET .../export?includeText=0|1`、`POST /api/canon/packages/import`。
- 原著页新增「全书汇编」段与 分章/人物与世界索引/时间线 三个视图；书架新增原著包导入；检视器总览带汇编进度。
- 验证：`pnpm check` 通过；`v5-canon`（8 条，含全书汇编/导出/导入）与 `v5-inspector`（2 条）e2e 通过；`.walk/walk9.spec.ts` 桌面/手机截图已看。

## 下一步
1. `canon/04`：新建故事弹窗的「从原著开局」，用 `buildCanonStartingPages` / `buildCanonWorldIndex` 与开局事件。
2. `canon/05`：原著窗口与游标，上下文里按锚点切片；「允许模型知道全书」默认关。

## 眼下要注意
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm --filter @dramaticer/web build`。
- e2e 假渠道靠系统提示词首句分流：抽取是「你是原著的事件抽取器」，汇编三句见 `compile-prompt.ts`；改提示词必须同步 `fake-channel.mjs`。
- 原著页 `/canon` 书架现在有两个 file input（txt 与 .json），e2e 用 `accept` 区分，不要再写 `input[type="file"]`。
- 不含原文的原著包不能汇编也不能抽取；`has_text = 0` 的页面只显示汇编结果。
- 迁移版本现在是 78，`assistant-store.test.ts` 的断言要一起改。
