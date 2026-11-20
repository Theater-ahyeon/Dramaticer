# 03：NovelAI 按模型族生成请求

**What to build:** V3 / V4.x / V5 三套请求体（见规格）；模板支持自定义模型 id、Medium 档、负面预设、固定 seed、多样性增强、坐标开关；本地队列与 429 退避；`*.live.test.ts` 用 `.env` 的 `NOVELAI_API_KEY` 实测一张（默认跳过）。

**Blocked by:** image-v2/02

**Status:** ready-for-agent

- [ ] 三套请求体各有单元测试（假服务器）
- [ ] 429 时按退避重试
- [ ] live 测试在人类提供令牌后跑通一次（不阻塞其他工单）
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
