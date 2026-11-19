# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-19（人工会话，架构审查后连续推进）。人类要求：先做完整 MVP 再慢慢优化，允许大改；重写设计文档；做轻量、最美观的前端。
  - `refactor/01` 完成：新故事默认 v4 导演 `lines`，功能页「场记」「档案归档」驱动后台（ADR-0161）。
  - `refactor/02` 部分完成：接通重逢注入、知情标注、伏笔上限、规则执行、行动选项；功能页对没接通的开关标「尚未生效」。剩余项要人类决定（HUMAN-25）。
  - `docs/DESIGN.md` 重写为现状 v1.0（MVP 定义 §15.2、北极星指标 §14.1、记忆参考 §7.7）。
  - `ui-lite/01` 完成：去掉 three.js 背景、指针特效、开场动画和打包字体（ADR-0162），前端产物 14 MB+ → 681 KB。
- 门禁：`pnpm check` 2753 通过；`pnpm e2e` 70 通过。
- 仍在分支 `spec/v4-remaining`，没有合并到 `main`。

## 下一步
1. `ui-lite/02`：新设计系统（纸与墨两套主题、朱砂一个强调色、系统字体字号阶梯、去掉玻璃模糊），重写 `v4.css`，设置页加「外观」。保留类名，e2e 不为换皮重写。
2. `ui-lite/03`–`05`：故事页阅读体验、其余页面、旧面板（之后删 `styles.css`）。
3. `refactor/03`（后台渠道保底）、`refactor/04`（北极星指标）。
4. 等人类回复 HUMAN-25（检索 / 工具 / 思考开关的默认值）后完成 `refactor/02`。

## 眼下要注意
- 已有故事保存的 `directorOrganization` 不迁移，仍是 `mechanisms`。
- 伏笔上限只看功能页（`readStoryPromiseLimit`），`directorConfig.maxOpenPromises` 不再生效。
- Vertex：人类用 GCP 服务账号 JSON 密钥；现有 `google-vertex` 渠道已支持，暂不测试（HUMAN-24 已关）。
- server 读的是 core 的 `dist`：改了 core 导出后先 `pnpm --filter @dramaticer/core run build`。
- `v4.css` 里仍有大量玻璃与渐变样式，是 ui-lite/02 的重写对象，不要在旧样式上继续叠补丁。
