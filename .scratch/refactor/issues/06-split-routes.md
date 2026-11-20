# 06：按领域拆分 server 路由

**What to build:** `server/src/routes.ts`（约 3,700 行）按领域拆成 `routes-<领域>.ts`（已有 `routes-card.ts` 的做法）：故事与楼层、回合、记忆、大纲、设定、设置与渠道、导演、助手、媒体。保留一个路由表入口，路径、方法、请求与响应格式一个不变。

**Blocked by:** refactor/01（MVP 之后做）

**Status:** done

- [x] 接口路径与 `protocol` 类型不变；server 测试与 `pnpm e2e` 全绿即证明
- [x] 每个路由文件不超过约 800 行
- [x] 共用的参数校验与错误响应集中在一个模块，不在各文件里复制
- [x] `pnpm check` 与 `pnpm e2e` 通过

规格：`.scratch/refactor/spec.md`

## Comments

完成：2026-11-19 用语法树脚本把 `routes.ts`（3,718 行）的处理函数原样搬到 7 个 `routes-<领域>.ts`，共用校验在 `routes-common.ts`；`routes.ts` 只剩选项类型与分发（562 行），所有文件 ≤ 800 行。`routes-next.ts` 里与 common 重复的 `allow`/`bad`/`readObject`/`requireStory` 删除，next、memory、card 改用 common。接口路径与协议类型不变，check 2860 通过。
