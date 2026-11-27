# 03：全书汇编

**What to build:** 合并同名与别名、排定事件顺序与相对时间线、为每个实体生成记事页底色与一行简介、标关键转折；生成原著故事包（可导出，默认不含原文）。

**Blocked by:** canon/02、memory-v5/03

**Status:** done

- [x] 合成 fixture 的别名合并正确
- [x] 实体记事页与世界索引生成
- [x] 导出包不含原文，导入他人的包无需重跑抽取
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 全书汇编、实体底色与世界索引、原著故事包导出导入。
