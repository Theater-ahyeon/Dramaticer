# 01：导入与分章

**What to build:** 上传 txt（UTF-8 / GB18030 自动识别），按标题规则分章；分章预览页可合并、拆分、改标题；存 `canon_books`、`canon_chapters`（原文分段）。

**Blocked by:** 无

**Status:** done

- [x] 合成小说 fixture（含卷、章、番外与异常标题）分章正确
- [x] GB18030 文件导入正确
- [x] 分章可编辑并保存
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments
完成：2026-11-27 编码识别（UTF-8/UTF-16/GB18030）、分章与兜底、迁移 76 与 CanonRepo、导入与合并拆分接口、`/canon` 书架与分章编辑页；`v5-canon` e2e 与走查截图通过。
