# 05：按领域拆分 StoryStore

**What to build:** `core/src/store/story-store.ts`（约 1.2 万行、276 个方法）按领域拆成 `store/repos/<领域>.ts`：楼层与路径、故事与设置、状态与台账、记忆记录与检索、场次与档案、导演、大纲、助手、开局、导入与设定、生图、插件。`StoryStore` 保留为外观：公开方法签名一个不变，方法体委托给领域模块；行类型与转换函数跟着领域走。

**Blocked by:** refactor/01（MVP 之后做，除非挡住了 MVP 工作）

**Status:** ready-for-agent

- [ ] 外部调用方（86 个文件）不需要改动；`pnpm check` 全绿即证明
- [ ] 每个领域模块不超过约 1,500 行；`story-store.ts` 只剩构造、事务、外观委托
- [ ] 按领域分几次提交，每次提交门禁都通过，可以单独回滚
- [ ] 不改 SQL、不改迁移、不改公开类型
- [ ] NOTES 的存储小节写明新的文件地图

规格：`.scratch/refactor/spec.md`

## Comments
