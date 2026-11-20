# 06：全站文案清洗

**What to build:** 按 v5 §5.4 的规则与对照表逐页改；删除标题下解释架构的句子；术语统一进 GLOSSARY（思考：关闭 / 低 / 高；档位：轻量 / 标准 / 完整；大纲：进行中 / 已偏离 / 已达成；未分类）。

**Blocked by:** ui-v2/05

**Status:** ready-for-agent

- [ ] 对照表里的每一条都已替换
- [ ] 页面上没有用「它」指代模型的句子，没有解释架构原则的占位符
- [ ] GLOSSARY 与界面一致
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/ui-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
