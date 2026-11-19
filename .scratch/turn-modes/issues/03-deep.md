# 03：深度：起草、自查、修改、交稿

**What to build:** 选深度时模型在草稿文件上工作，拿到程序生成的自查清单，用通用文件工具读取故事数据。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 真实渠道上工具调用率大于 0（2026-11-19 实测：16 轮深度回合里 1 轮调用工具、共 5 次 `file_read`，调用率 6.25%；单轮冒烟里同一模型首轮调用 8 次，含 `draft_write` 与 `commit_draft`）
- [x] 自查清单包含状态、不知情者、最近节拍、偏好与待埋伏笔
- [x] 模型直接输出正文时照常成为一楼（实测 16 轮里 15 轮直接输出，每轮都成为一楼并写入 Trace）
- [x] 失败率明显低于 23%（同一批次 16 轮 0 失败，0%）
- [x] `pnpm check` 通过（集成分支整仓门禁通过：322 个测试文件、2744 个用例）

规格：`.scratch/turn-modes/spec.md`

## Comments

完成：2026-11-19 深度写法把故事数据按文件树交给 read/search 工具、把草稿交给 write/patch 工具，自查清单注入五类事实，直接输出仍自动成为一楼。

真实渠道签字（2026-11-19）：`packages/st-compat/test/deep-live.test.ts`（`DRAMATICER_LIVE=1 DRAMATICER_DEEP_TURNS=16`），渠道 `main`（deepseek-v4.1-flash），16 轮深度回合：工具调用 1 轮、5 次 `file_read`（调用率 6.25%），失败 0 轮（0%），每轮都写成一楼并写入 Trace；另跑 1 轮冒烟，首轮 8 次调用含 `draft_write` 与 `commit_draft`。
观察到：首轮最愿意用工作区，后续回合多数直接写正文（I13 允许）。若要让草稿循环成为常态，需要在深度提示词里收紧「先草稿、后交稿」的触发条件，另开改进项，不影响本工单验收。
