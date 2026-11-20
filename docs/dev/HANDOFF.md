# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-20（人工会话，项目整理）。人类要求「全部解决」上次盘点出的优化项，并逐项拍板：
  - 许可证：AGPL-3.0-only。根目录 `LICENSE`（GNU 官方全文），各 `package.json` 加 `license`，README 许可证一节改写。
  - `AGENTS.md`（人类授权）：开头定位与 DESIGN §0 一致；文档地图改为「DESIGN 是唯一设计权威」；I6 注明快速、规划、深度；I12 改为「台账是唯一的结构化视图，写入须有原文出处」。`.devloop/protected.sha` 与快照已同步。
  - HUMAN：03、15 取消；20、21、23 完成。17、18（两个兼容插件的上游许可证）人类本次未表态，仍待处理。
  - CI：`.github/workflows/check.yml`（Ubuntu、Node 22、`pnpm check`）。**还没在 GitHub 上跑过**，首次推送后看结果；Linux 上若有只在 Windows 成立的路径假设会在这里暴露。
  - 门禁拆分：vitest `unit` / `eval` 两个项目，`pnpm test` 只跑 unit（301 个文件），`pnpm test:eval` 跑 33 个评测测试文件。本次 eval 项目未单独跑（测试本身没改）。
  - 早期脚本 `scripts/f0-*`、`r1-*`、`r2-*`、`r5-*` 移到 `scripts/archive/`，删掉对应 `package.json` 命令名。
  - 同期人类自己在改 README 与 `.gitignore`（`dist-release/`）、新增 `package:release` 脚本，已一并提交。
- 门禁：`pnpm check` 通过（unit：2565 通过，6 跳过）。本机这次耗时 182 秒，没有变快，主要瓶颈仍是 Windows 杀毒扫描临时目录（HUMAN-16）。

## 下一步（都需要人类）
1. 配后台跨供应商保底（HUMAN-19，人类选择自己配）：`channels.example.yaml` 的 `bg2` 示例。
2. 试玩 2–3 个故事，跑 `stats rerolls` 拿北极星数字；之后另开工单决定是否删除 `mechanisms`。
3. 回复 HUMAN-17、18；HUMAN-16（Defender 排除 `Temp` 与仓库目录）。
4. 推送后检查 CI 首跑。

## 眼下要注意
- 远端：`origin` = GitHub 公开仓库，只推 `main`；本地 `backup/main-original` 与旧 `spec/*`、`ticket/*` 分支是旧邮箱，不要推。
- 新增评测类测试要加进 `vitest.config.ts` 的 `evalTests`，否则会进默认门禁。
- 新存储方法写进领域仓储并加进 `story-store.ts` 的 `Pick<…>` 与 `DELEGATES`；新路由参数校验只用 `routes-common.ts`。
- server 读 core 的 `dist`：改了 core 导出后先 `pnpm --filter @dramaticer/core run build`。
