# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-20（人工会话，很长）。人类确认 v5 方案（`docs/proposals/v5.md` 定稿，ADR-0168），工单在 `.scratch/` 的 `ui-v2`、`memory-v5`、`direction-v5`、`canon`、`image-v2`、`card-ui`，共 25 张。
- 本会话做完：
  - 许可证 AGPL-3.0、GitHub Actions 门禁、vitest 拆 unit/eval、旧脚本归档。
  - 写作条目（预设的位置与深度注入）与 NovelAI 基础后端（ADR-0167）。
  - AGENTS.md 的 I6、I9、I11 按人类授权改写（HUMAN-26）；未动 `.devloop/protected.sha`，devloop 下次启动自动接受。
  - **ui-v2/01 完成**：全局设置页 `/settings`（连接向导、高级配置、外观）、书架新建故事弹窗、保存密钥与模型列表接口、无渠道文件可启动（ADR-0169）。
- 门禁：`pnpm check` 通过（unit 298 文件）；ui-v2/01 相关 e2e 全过，此前一次全量 e2e 83 过、3 跳过（之后只改了书架按钮与外壳，相关用例已重跑）。

## 下一步
1. `ui-v2/02` 故事页输入台与楼层操作（v5 §8.2）。动手前读人类 TauriTavern 的界面设置作参照（只读 settings，不读 secrets）。
2. 之后按 `.scratch/README.md` 的 v5 顺序：ui-v2 03–05 → memory-v5 → canon → card-ui / image-v2 → ui-v2/06。

## 眼下要注意
- 手机底栏现在 8 项（多了「全局」），`ui-v2/05` 拆「更多」后回到 7 项；`v4-shell.spec.ts` 的数量与 `.navs .ind` 宽度要一起改。
- 读人类本机 ST 数据时：settings.json 有 19 MB，只用脚本列结构并打码；打码规则要覆盖 `novelaiApi` 这类不含 key 字样的字段。
- 远端：只推 `main`；`backup/main-original` 与旧 `spec/*`、`ticket/*` 分支不要推。
- 新存储方法写进领域仓储并加进 `story-store.ts` 的 `Pick<…>` 与 `DELEGATES`；新路由参数校验只用 `routes-common.ts`。
- server 读 core 的 `dist`：改了 core 导出后先构建 core；单跑 e2e 前先构建 web 与 server。
