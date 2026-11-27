# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `canon/04`）。从原著开局：新建故事弹窗第三项、两种扮演身份、可选叠加角色卡、故事绑定与初始游标。
- 迁移 79：`story_canon`（每故事一条绑定，`player_page` 是 JSON，`allow_full_book_spoilers` 默认 0）与 `canon_cursors`（主键 `story_id + node_id`，随楼层删除回退）。
- `core/src/canon/start.ts`：`startCanonStory` 由调用方事务包裹；按开局章节切片实体与记事页；扮演的原著人物不进 NPC 名册，切片写进 `player_page` 与 `persona`；首楼、初始游标、最多 3 条原著方向。
- 接口：`POST /api/canon/start-story`（一步建故事并可选叠卡，失败整步回滚）、`GET /api/stories/:id/canon`（`{ bound: null }` 或绑定详情）。
- 叠卡复用 `importCardContent({ skipCharacterEntity: true })`：保留文风/规则、`characterPrompt` 与推荐配置；卡的角色实体与开场白都不进原著故事。
- `NewStoryDialog` 新增「从原著开局」：已汇编书目、开局事件（标关键转折）、原著人物/自创人物、叠加角色卡。手机弹窗改为内部滚动并避开底部导航。
- 验证：`pnpm check` 通过（292 个测试文件）；`v5-canon-start` 4 条（桌面+手机，两种身份）通过；`v5-canon`、`v5-direction`、`v4-story`、`v4-shell` e2e 通过；`.walk/walk10.spec.ts` 桌面/手机截图已看。

## 下一步
1. `canon/05`：原著窗口与游标，上下文按锚点切片；推进到下一件 / N 件；「从这里开始」；删楼与分支后游标回退。
2. 从 `story_canon.player_page` 与 `canon_cursors` 取数；「允许模型知道全书」默认关，只能由玩家显式打开。

## 眼下要注意
- 迁移版本现在是 79，`assistant-store.test.ts` 的断言已同步。
- server 与 e2e 读 core 的 `dist`：改了 core 先 `pnpm run build` 再跑 e2e。
- 新建故事是 `form` 角色而不是 `dialog`；弹窗里的「原著」下拉与「开局事件」选项文本会互相污染 label，两处都加了 `aria-label`，e2e 按 aria-label 定位。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts`，截图在 `.devloop/scratch/walk/`。
