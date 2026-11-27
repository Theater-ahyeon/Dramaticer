# 02：推进方向菜单与删减

**What to build:** 推进时显示 2–3 个方向（后台场末或间隙里备好，只预跑推进一条）；删除八种动作的程序选择、`mechanisms` 引擎、提前备好的选项预跑；规划、深度写法移入实验区。

**Blocked by:** direction-v5/01

**Status:** done

- [x] 推进菜单 e2e
- [x] 删除后 `pnpm check` 与导演相关测试按新行为改写通过
- [x] I9、I11 新文字在 DESIGN 与代码注释里一致
- [x] `pnpm check` 通过；动到 server 或 web 的跑相关 e2e，并用走查脚本（`packages/web/.walk/`）重新截图逐页确认

规格：`.scratch/direction-v5/spec.md`；方案：`docs/proposals/v5.md`

## Comments

完成：2026-11-27 推进菜单给 2–3 个方向（`readDirectionView().pushDirections` 当场派生，不额外占后台调用），点方向把 `（推进方向：…）` 写进玩家消息；删除 `mechanisms` 引擎、六个机制模块、每拍动作选择与插件内核机制扩展点，旧 `directorOrganization` 降级为 `lines`，旧决策只读兼容；规划准备只预跑推进一条；规划与深度写法收进故事设置「高级 → 实验」。`pnpm check` 通过；`v5-direction`、`director`、`v4-story`、`v4-dock`、`v4-prefs`、`v5-composer`、`v4-outline` 的 e2e 通过；`walk6` 截图已看（`v5-02-pushmenu-{d,m}.png`、`v5-02-experiment-{d,m}.png`）。
