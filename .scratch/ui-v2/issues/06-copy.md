# 06：全站文案清洗

**What to build:** 按 v5 §5.4 的规则与对照表逐页改；删除标题下解释架构的句子；术语统一进 GLOSSARY（思考：关闭 / 低 / 高；档位：轻量 / 标准 / 完整；大纲：进行中 / 已偏离 / 已达成；未分类）。

**Blocked by:** ui-v2/05

**Status:** done

- [x] 对照表里的每一条都已替换
- [x] 页面上没有用「它」指代模型的句子，没有解释架构原则的占位符
- [x] GLOSSARY 与界面一致
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 对照表 13 条全部替换；删除各页标题下的架构说明与文艺腔（登录标语、记忆 / 设置副标题、设定与原著说明、导入兼容说明等）；后台失败条改为「后台任务连续失败 N 次：原因」，「检查渠道」指向全局设置 `/settings`（原 `/stories/:id/channels` 没有路由）；思考、档位、剧情线状态、未分类与 GLOSSARY 同步。`pnpm check` 通过；相关 e2e 59 项通过（v4-story 首跑一次无「正文」阶段，单跑 6/6 通过）；`walk19` 桌面与手机 10 个页面截图已逐张查看。
