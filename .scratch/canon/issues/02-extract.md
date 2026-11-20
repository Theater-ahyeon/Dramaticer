# 02：按章抽取与预估

**What to build:** 预估页（章数、字数、预计 token 与费用）；后台任务按章抽取事件（标题、概要、缩写、参与人物、地点、相对时间、段落范围）、话术（说 / 想）、实体增量；可暂停、续跑、单章重跑；进度在检视器与原著页可见。

**Blocked by:** canon/01、memory-v5/01

**Status:** ready-for-agent

- [ ] 假模型下全书抽取完成并落库
- [ ] 中途停止后续跑不重复已完成章
- [ ] 失败章可单独重跑
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/canon/spec.md`；方案：`docs/proposals/v5.md`

## Comments
