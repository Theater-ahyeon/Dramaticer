# 03：NovelAI 按模型族生成请求

**What to build:** V3 / V4.x / V5 三套请求体（见规格）；模板支持自定义模型 id、Medium 档、负面预设、固定 seed、多样性增强、坐标开关；本地队列与 429 退避；`*.live.test.ts` 用 `.env` 的 `NOVELAI_API_KEY` 实测一张（默认跳过）。

**Blocked by:** image-v2/02

**Status:** done

- [x] 三套请求体各有单元测试（假服务器）
- [x] 429 时按退避重试
- [ ] live 测试在人类提供令牌后跑通一次（不阻塞其他工单）
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/image-v2/spec.md`；方案：`docs/proposals/v5.md`

## Comments
- 完成：2026-11-27 V3/V4.x/V5 三套请求体、模板扩展参数、人物结果接入、fixedSeed、同 provider 串行队列与每分钟上限、429 退避；`pnpm check` 2571 通过（7 个 live 跳过）；`v5-novelai-template`、`v5-image-organizer`、`v5-image-profiles`、`v4-prefs` 桌面/手机 e2e 通过；`walk17` 截图已看。
- live 测试已写 `packages/core/test/novelai.live.test.ts`，读 `.env` 的 `NOVELAI_API_KEY`，本机没有令牌因此保持未勾选；人类填入后运行 `pnpm vitest run packages/core/test/novelai.live.test.ts` 即可。
