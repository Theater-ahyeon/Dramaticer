# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `ui-v2/06`）。**v5 的 25 张工单（M-A 至 M-E）全部完成**：`ui-v2` 01–06、`memory-v5` 01–05、`direction-v5` 01–02、`canon` 01–06、`card-ui` 01–02、`image-v2` 01–04。
- 全站文案按 `docs/proposals/v5.md` §8.3 清洗：404 用「页面不存在」；「上下文」「输入行动或对话」「重写原因（可选）」「撤回」；思考关闭/低/高；档位轻量/标准/完整；剧情线状态进行中/已偏离/已达成；未分类；后台失败条改为「后台任务连续失败 N 次：原因」。
- 后台失败条的「检查渠道」原指向不存在的 `/stories/:id/channels`，现指全局设置 `/settings`；故事下没有渠道路由。
- 删除标题下的架构说明与文艺腔：登录标语、记忆/设置副标题、设定与原著说明、导入兼容说明、模板覆盖说明、画面整理作用域说明等；占位符只留操作。
- `GLOSSARY.md` 同步界面术语（思考三档、档位三档、剧情走向状态、未分类、未收的线）。
- server 的后台保底提醒同步改成「主渠道失败时后台任务会中断」。
- 验证：`pnpm check` 通过（2577 用例、7 个 live 跳过）；受影响 e2e 59 项通过（v4-story 首跑一次阶段条没等到「正文」，单跑 6/6 通过，属既有偶发）；`walk19` 桌面与手机各 10 页截图已逐张看过。

## 下一步
1. 没有待做的工单。下一阶段按 `docs/DESIGN.md` 与人类新需求开新功能目录。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `pnpm vitest run packages/core/test/novelai.live.test.ts`，勾掉 `image-v2/03` 工单最后一项。

## 眼下要注意
- server 与 e2e 读 core 的 `dist`：改 core/st-compat 后先 `pnpm run build` 再跑 e2e。
- 界面文案对照表在 `docs/proposals/v5.md` §8.3；改词要同步 `GLOSSARY.md` 与以文字定位的 e2e。走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk19.spec.ts`。
- 回写提示词只改 `node_images`，任何情况下都不碰楼层 `raw`（I4/I8）。
- 插图接口的 `url` 带更新时间版本；改文件名或缓存策略时同步改 `toNodeImage` 与相关测试。
- `.walk/` 不入库；截图落在 `.devloop/scratch/walk/`。
