# 04：检视器抽屉与全局助手

**What to build:** 全局快捷键呼出检视器：本轮上下文与来源、token 与耗时、后台任务、拒收记录、渠道体检、重写率、每楼后台调用数；输入台不再显示 token 与耗时。助手抽屉挂到外壳，任何页面可呼出。

**Blocked by:** ui-v2/02

**Status:** ready-for-agent

- [ ] 故事、记事、设定页都能呼出助手与检视器
- [ ] 一级界面不再出现 token、缓存命中、耗时数字
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
