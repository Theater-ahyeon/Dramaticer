# 06：按领域拆分 server 路由

**What to build:** `server/src/routes.ts`（约 3,700 行）按领域拆成 `routes-<领域>.ts`（已有 `routes-card.ts` 的做法）：故事与楼层、回合、记忆、大纲、设定、设置与渠道、导演、助手、媒体。保留一个路由表入口，路径、方法、请求与响应格式一个不变。

**Blocked by:** refactor/01（MVP 之后做）

**Status:** ready-for-agent

- [ ] 接口路径与 `protocol` 类型不变；server 测试与 `pnpm e2e` 全绿即证明
- [ ] 每个路由文件不超过约 800 行
- [ ] 共用的参数校验与错误响应集中在一个模块，不在各文件里复制
- [ ] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`

## Comments
