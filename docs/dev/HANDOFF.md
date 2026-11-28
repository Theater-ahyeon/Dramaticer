# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（全仓收口与全量门禁验证）。在 v5 全部 25 张工单完成后完成收口，全仓 `pnpm check` 与 `pnpm e2e` 零失败通过：
  - 后台调度与文件写入：恢复 `BackgroundScheduler` 默认排空上限为不传 `limit`（走 `DEFAULT_BACKGROUND_JOB_LIMIT`）并保留最近调度故事队头优先；抽取 `packages/server/src/atomic-write.ts` 对同一路径串行排队并对 Windows 瞬时 `EPERM`/`EBUSY`/`EACCES` 改名重试，同时让 `handleChannelProbe` 在体检结束后重读最新 `channels.yaml` 再写回探测结果，避免并发修改互相覆盖。
  - E2E 稳定性修复：适配 `playtest/runner.ts` 至 v5 界面与接口；`v4-story.spec.ts` 在刷新后补充 `observeStages`；`v2-setup.spec.ts` 连接向导等待「已保存，测试通过」再恢复配置，消除 `probeChannel` 异步覆盖 `channels.yaml` 的竞争；`v4-dock.spec.ts` 的 `seedDockStory` 补写 `scene_log` 已完成任务记录，防止后台调度覆写预设 `scene_card`。
  - 文档对齐：`docs/DESIGN.md`、`README.md` 与 `docs/dev/NOTES.md` 同步至 v5 现实（三速记忆、剧情走向两栏与推进方向、原著工作流、楼层渲染沙箱、分格视觉档案与画面整理、最新测试数字与体积预算）。
- 验证：`pnpm check` 全绿（不变量通过、typecheck 通过、biome 1001 文件零错误、unit 305 文件 2,579 用例通过 / 7 live 测试按预期跳过）；`pnpm e2e` 全绿（首屏 JS 171.5 / 200 KB，CSS 15.7 / 40 KB gzip，Playwright 135 项通过 / 3 项按预期跳过，0 失败）。

## 下一步
1. 没有待做的开发工单。`.scratch/refactor/issues/07-eval-package.md` 按人类指示（`2026-11-19`「暂时不用评测」）继续延后。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `pnpm vitest run packages/core/test/novelai.live.test.ts`，核对 `image-v2/03` 的 live 验收项。
3. 后续进入真卡长线试玩（100+ 楼北极星指标）与 `.scratch/PARKED.md` 中的 Post-MVP 事项。

## 眼下要注意
- server 与 e2e 读取 `core`/`protocol`/`st-compat` 的 `dist`；修改上述包后需先构建再单独跑 e2e（`pnpm e2e` 会自动触发完整构建）。
- e2e 共享同一个后台 `BackgroundScheduler`：在测试里直接向 SQLite 写入已结算内容（如 `scene_logs`）时，需一并写入对应的 `done` 状态 `background_jobs` 记录，避免后台队列重复覆盖。
