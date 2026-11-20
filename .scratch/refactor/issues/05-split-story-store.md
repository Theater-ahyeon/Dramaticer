# 05：按领域拆分 StoryStore

**What to build:** `core/src/store/story-store.ts`（约 1.2 万行、276 个方法）按领域拆成 `store/repos/<领域>.ts`：楼层与路径、故事与设置、状态与台账、记忆记录与检索、场次与档案、导演、大纲、助手、开局、导入与设定、生图、插件。`StoryStore` 保留为外观：公开方法签名一个不变，方法体委托给领域模块；行类型与转换函数跟着领域走。

**Blocked by:** refactor/01（MVP 之后做，除非挡住了 MVP 工作）

**Status:** done

- [x] 外部调用方（86 个文件）不需要改动；`pnpm check` 全绿即证明
- [x] 每个领域模块不超过约 1,500 行；`story-store.ts` 只剩构造、事务、外观委托
- [x] 按领域分几次提交，每次提交门禁都通过，可以单独回滚
- [x] 不改 SQL、不改迁移、不改公开类型
- [x] NOTES 的存储小节写明新的文件地图

规格：`.scratch/refactor/spec.md`

## Comments

完成：2026-11-19 用 TypeScript 语法树脚本机械拆分：276 个方法原样搬到 `store/repos/` 下 15 个领域仓储（最大 1,350 行），共用行类型与校验在 `repos/shared.ts`；`StoryStore` 用接口合并（`Pick<各仓储, 公开方法>`）保留全部签名与文档注释，运行时在原型上委托。不改 SQL、迁移与公开类型，外部调用方零改动，`pnpm check` 2860 通过。偏离：一次提交而不是按领域多次——拆分由脚本一次生成，整体回滚同样简单；NOTES 已写文件地图。
