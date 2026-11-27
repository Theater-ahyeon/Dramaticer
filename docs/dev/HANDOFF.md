# 交接

> 每次收尾时完整重写，不超过 40 行。长期有效的注意事项写进 `docs/dev/NOTES.md`。

## 最近一次
- 2026-11-27（工单 `image-v2/03`）。**NovelAI 按模型族生成请求、模板扩展参数、本地队列与 429 退避**。
- `novelai-params.ts` 新增 `mediumTier`、`negativePreset`、`fixedSeed`、`useCoords`、`straightAlpha`、`tagHintQt`、`tagHintUcPreset`；旧模板缺字段时补默认值，`model` 接受任意自定义 id。
- `buildNovelAiRequestBody` 分三套：V3 把人物提示词与人物负面拼回扁平字段；V4.x 发 `v4_prompt` / `v4_negative_prompt` / `characterPrompts`，`varietyBoost` 时按尺寸算 `skip_cfg_above_sigma`；V5 用 `params_version: 4`，不发跳过 CFG、旧参考数组与默认噪点表，带 `straight_alpha` 与 `tag_hint_*`，Medium 档换 `-medium` 模型。
- 负面预设映射 `ucPreset`（Heavy 0、Light 1、Furry 2、Human 3、None 4），非 None 的预设词由程序拼进负面提示词。
- 出图任务从 `node_images.organizer_result.expanded` 里按 prompt 与 negative 找人物并传坐标与人物级负面；模板 `fixedSeed` 优先于楼层 seed。
- NovelAI 客户端同 provider 串行，按 provider 的 `maxRequestsPerMinute`（默认 10）排队；429 读 `Retry-After`，否则指数退避，默认最多再试 3 次。
- 模板界面：V5 Full/Curated、自定义模型 id、Medium 档、负面预设、固定 seed、多样性、坐标、V5 三个开关；`images import` 只在 comfyui 后端里选 provider。
- live 测试 `novelai.live.test.ts` 读 `.env` 的 `NOVELAI_API_KEY`，本机没有令牌，默认跳过。
- 验证：`pnpm check` 通过（2571 用例通过、7 个 live 跳过）；`v5-novelai-template`、`v5-image-organizer`、`v5-image-profiles`、`v4-prefs` 桌面/手机 e2e 通过；`walk17` 截图已看。

## 下一步
1. `image-v2/04`（插图插段与重绘）：复用 `organizer_result` 的段落位置与可取消的出图任务。
2. 人类填入 `NOVELAI_API_KEY` 后跑一次 `pnpm vitest run packages/core/test/novelai.live.test.ts`，勾掉工单最后一项。

## 眼下要注意
- server 与 e2e 读 core 的 `dist`：改 core/st-compat 后先 `pnpm run build` 再跑 e2e。
- 模板默认 `negativePreset: "heavy"`，旧模板保存后第一次出图也会带 Heavy 预设词；需要完全自定义负面时选 None。
- e2e 的 `serve.mjs` 在 images.yaml 里加了假 NovelAI 后端（key 走 `${E2E_NAI_KEY}`），配置里同时有 comfyui 与 novelai 时按 api 过滤选 provider。
- 429 与每分钟上限在 `createNovelAiClient` 内，测试注入 `sleep` / `now`；不要另起第三方排队。
- `.walk/` 不入库；走查命令 `cd packages/web && npx playwright test -c .walk/walk.config.ts .walk/walk17.spec.ts`。
