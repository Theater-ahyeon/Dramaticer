# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `canon/01`）。M-C 原著开工：导入、分章与分章编辑完成。
- `core/src/canon/`：`decode.ts` 自动识别 UTF-8（含 BOM）、UTF-16 LE/BE、GB18030；`split.ts` 识别卷、章、序章/尾声/番外、英文 Chapter/Volume 与无标号短行，正文「第三天」不误切；无标题时按 6000 字兜底。
- 迁移 76 新增 `canon_books`、`canon_chapters`（段落 JSON，STRICT，级联删除）；`CanonRepo` 支持导入、列表、单章读取、改标题/类型、与下一章合并、按段落拆分、删除。
- 接口 `/api/canon/books` 系列；导入只收 `text` 或 `dataBase64`，请求体上限 48 MB；分章列表不带原文。
- 页面 `/canon` 与 `/canon/:bookId`：拖拽上传 txt、章节列表、段落带序号、改标题/类型、合并、拆分、删除。导航栏仍是 7 项，入口在书架 `lib-bar` 与命令面板。
- 验证：`pnpm check` 通过；`v5-canon`、`v4-shell`、`cover`、`v4-a11y` 通过；体积预算 153.1/200 KB JS、14.3/40 KB CSS；走查 `.walk/walk7.spec.ts` 截图已看（桌面与手机）。

## 下一步
1. `canon/02`：按章抽取与预估（见 `.scratch/canon/`）。

## 眼下要注意
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先 `pnpm build`。
- e2e 的 `helpers.sendTurn` 走故事页；调用前页面要停在 `/play`。
- 原著列表接口不带段落；读一章原文走 `/api/canon/books/:bookId/chapters/:chapterId`。
- 合并与拆分靠 `RENUMBER_OFFSET` 两段式重排，不要改成直接 `ordinal +/- 1`，会撞唯一约束。
- 新增迁移要同步 `assistant-store.test.ts` 的 schema 版本断言（现在 76）。
