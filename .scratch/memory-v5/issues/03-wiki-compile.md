# 03：记事页场末补丁编译

**What to build:** 新存储：实体页分「底色 / 现在 / 经历」三节，每次编译产生新版本；场末编译只做补丁（追加经历、刷新现在、底色只在不可逆转折时追加）；玩家锁定的节跳过；旧故事打开时后台用已有记录建初版。

**Blocked by:** memory-v5/01

**Status:** ready-for-agent

- [ ] 假模型下场末产生补丁、版本可回看与回滚
- [ ] 锁定节不变
- [ ] 旧库迁移后每个实体有初版页面
- [ ] 记事页版本记录产生它的楼层，切到旧分支时取该路径上最近的版本
- [ ] 刷新「现在」产生新版本，不改旧版本与底层记录（DESIGN §16）
- [ ] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/memory-v5/spec.md`；方案：`docs/proposals/v5.md`

## Comments
