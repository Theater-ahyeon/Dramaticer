# 02：NovelAI 多人物与参数

**What to build:** 请求体填多人物 caption 与人物级负面提示（格式实测或有据核对后再写）；模板支持自定义模型 id（V5 等新模型不用改代码）、固定 seed、多样性增强；写一个 `*.live.test.ts` 用 `.env` 的 `NOVELAI_API_KEY` 实测出一张图（默认跳过）。

**Blocked by:** image-v2/01

**Status:** ready-for-agent

- [ ] 单元测试用假服务器覆盖多人物请求体
- [ ] live 测试在人类提供令牌后跑通一次（不阻塞其他工单）
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
