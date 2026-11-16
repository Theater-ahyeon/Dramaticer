# 02：突发延后，节奏只在推进时生效

**What to build:** 剧情线到点时玩家正在自己写，突发不打断，留到下一次推进或这一场结束；「过于顺利」不在玩家自己写时触发。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 玩家自由输入的回合里不出现突发与加阻碍
- [ ] 延后的突发在下一次推进时发生
- [ ] 标记为必须打断的事件可以打断，每场最多一次
- [ ] `pnpm check` 通过

规格：`.scratch/director-yield/spec.md`

## Comments
