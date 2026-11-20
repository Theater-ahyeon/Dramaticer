# 01：导入与分章

**What to build:** 上传 txt（UTF-8 / GB18030 自动识别），按标题规则分章；分章预览页可合并、拆分、改标题；存 `canon_books`、`canon_chapters`（原文分段）。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] 合成小说 fixture（含卷、章、番外与异常标题）分章正确
- [ ] GB18030 文件导入正确
- [ ] 分章可编辑并保存
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments
