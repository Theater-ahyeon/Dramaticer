# 03：后台渠道保底与失败可见

**What to build:** 后台岗位（结算、规划）在主渠道失败时切到另一个供应商；连续失败时界面告诉玩家「记忆与导演暂停了」以及原因，而不是静默不工作。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `channels.yaml` 校验：`bg-fallback` 与 `background` 走同一个渠道时，启动日志与设置页的模型分页给出警告
- [ ] 后台任务连续失败（如 402 额度、403、5xx）达到阈值时，故事页顶部显示一条可关闭的提示，带失败岗位、渠道与错误摘要；恢复后自动消失
- [ ] 渠道体检能对任意岗位单独运行，结果写回设置页
- [ ] `.env.example` 与 `channels.example.yaml` 写明后台建议配置两家供应商
- [ ] 不读取、不打印密钥；单元测试不访问网络
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`；DESIGN §10.2

## Comments
