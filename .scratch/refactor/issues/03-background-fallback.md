# 03：后台渠道保底与失败可见

**What to build:** 后台岗位（结算、规划）在主渠道失败时切到另一个供应商；连续失败时界面告诉玩家「记忆与导演暂停了」以及原因，而不是静默不工作。

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `channels.yaml` 校验：`bg-fallback` 与 `background` 走同一个渠道时，启动日志与设置页的模型分页给出警告
- [x] 后台任务连续失败（如 402 额度、403、5xx）达到阈值时，故事页顶部显示一条可关闭的提示，带失败岗位、渠道与错误摘要；恢复后自动消失
- [x] 渠道体检能对任意岗位单独运行，结果写回设置页
- [x] `.env.example` 与 `channels.example.yaml` 写明后台建议配置两家供应商
- [x] 不读取、不打印密钥；单元测试不访问网络
- [x] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`；DESIGN §10.2

## Comments

完成：2026-11-19 模型可写 `fallback`，后台岗位主模型所有渠道失败后改用保底（ADR-0165）；启动日志、`GET /api/channels` 的 `warnings`、设置页模型分页与渠道面板提醒保底共用渠道或缺失；`GET /api/stories/:id/background/health` 按「连续 3 条渠道失败」判断暂停，故事页顶部显示可关闭提示，成功一条即恢复；渠道体检支持按岗位；`.env.example` 与 `channels.example.yaml` 加了第二家供应商 `bg2`。HUMAN-19 已注明新的配置方法。
