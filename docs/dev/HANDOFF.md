# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-09 会话 264：完成 M6-T05（生图设置与 workflow 管理界面）。新增 `packages/web/src/pages/story/ImagesPage.tsx` 与“生图”导航/路由：provider 状态（只读地址、不显示密钥）、本地 JSON 导入、`detect` 识别结果与五个插槽下拉确认、`import` 保存、被引用删除时显示 409 原因、视觉档案列表与“重新生成”。新增 `POST /api/stories/:id/visual-profiles/generate`（只入队，已有档案也允许覆盖）；协议新增 `StoryVisualProfileGenerateResult`，web `api` 增加 provider/workflow/档案方法。设置页加载 workflow 下拉并把 `imageConfig` 接入表单；`packages/web/src/chat/image-form.ts` 负责 workflow 文本解析、插槽选择与校验、生图设置范围校验和错误路径中文名，新增 10 个测试与 1 个 server 用例；390×844 生图页与设置页 Playwright 冒烟通过（导入、识别、保存、刷新、409、重新生成、设置保存、关闭模式、无横向溢出、无密钥）。门禁通过：159 个测试文件、1409 个测试、4 个 live 跳过。
- 会话 263：完成 M6-T04（楼层图片显示与媒体接口）。`StoryPath` 的节点改为 `StoryPathNode`，path 与节点图片接口返回按 `ordinal` 排序的 `NodeImage`，整页图片用 `listNodeImagesForNodes` 一次查询；新增 `GET /api/images/:id/file`（只读 `done`、只接受 PNG/JPEG/WebP/GIF、真实路径确认仍在 `mediaDir`、未完成/失败/缺失/越界一律 404）；聊天页新增图片区、2 秒 15 次轮询、失败重试与共用放大层；新增 `chat/node-images.ts` 纯逻辑与 4 个测试、3 个 server 用例；390×844 浏览器冒烟通过。
- 会话 262：完成 M6-T03（`illustrate` 工具与异步出图队列）。`imageConfig` 接入故事设置；新增 `images/request.ts`、`images/tool.ts`、`images/queue.ts`、`images/client.ts`、`images/media.ts`；回合事务内登记 `node_images` 的 pending 行并把拒绝原因写进 Trace；后台任务每次处理两张、单行失败三次标记 failed；新增手动登记与重试接口、`images generate|list` CLI、`--media-dir`；server 与 `dramaticer work` 启动时把 running 图片行退回 pending。
- 会话 261：完成 M6-T02（角色视觉档案与提示词编译）。补上 `visual-profiles.test.ts`、`image-prompt.test.ts`、CLI `profiles --generate` 与 server 读取/入队测试；重复人物比较改为 `normalizeEntityName`。
- 会话 260：修复门禁。会话 257 的 autosave 写完了 M6-T02 的大部分实现，但 `packages/server/src/routes.ts` 调用了未定义的 `handleStoryVisualProfiles`，类型检查失败，另有 6 处 biome 格式与 import 顺序问题。补上该处理器，按 biome 输出手工修正格式；未改动实现逻辑。
- 会话 256：完成 M6-T01（生图配置、ComfyUI workflow 导入与插槽识别）。
- 会话 255：完成 M6-T00，把生图第一批分成 M6-T01 至 M6-T05 与 M6-T99，第二批分成 M6b-T01 至 M6b-T03 与 M6b-T99（排在 R6 之后）。
- 会话 254：完成 R5-T99，60 轮重跑跑满 60/60、0 条失败，R5 报告与 TASKS 已回填最终数据库数字。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T07.b.d.a 与 R1-T07.b.d.b）、R3、O、R2、E、R4、R5 全部（含 R5-T99）、V-T01、M6-T00 至 M6-T05。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个任务：M6-T99 M6 第一批验收**，依赖 M6-T01 至 M6-T05，需要 HUMAN-15：真实 ComfyUI 启动在 `http://127.0.0.1:8188` 并提供 API 格式 workflow JSON 到 `eval-private/comfyui/`。2026-11-09 探测时端口仍未监听；没有 ComfyUI 时任务无法完成，下一个会话按 HUMAN.md 的阻塞规则处理。
- v3 阶段顺序：R5（已完成）→ M6 生图第一批 → R1 续 记忆增强 → R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → M6b 生图第二批 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 待处理（不阻塞）：Vertex 真实调用还需要人类把服务账号 JSON 导出到仓库外，并在 `.env` 设置 `GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/`。
- HUMAN-12 已完成：人类确认保持 `judge`（`auto/glm-5.3`）作为裁判路由。HUMAN-13 已关闭：`writer` 继续用 `main-fallback`。HUMAN-11 已完成：`.env` 的正文模型已改为 `auto/deepseek-v4.1-flash`。
- 数据库 schema 版本 34（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 选择记录、v32 导演计划与拍状态、v33 导演候选行动、v34 生图表）。R1 续使用 v35–v38。

## M6 生图第一批
- 顺序：M6-T01（已完成）→ M6-T02（已完成）→ M6-T03（已完成）→ M6-T04（已完成）→ M6-T05（已完成）→ M6-T99。
- M6-T01：`images/config.ts` 解析 `data/images.yaml`（只有 `providers`，第一版只接受 `api: comfyui`，字段 `baseUrl`、`apiKey`、`timeoutMs` 默认 300000、`pollIntervalMs` 默认 1000；文件不存在返回空配置）；`images/slots.ts` 校验 API 格式 workflow 并识别正负提示词、seed 与宽高插槽；`images/comfyui.ts` 提交、轮询、下载第一张图，客户端不重试；`images/workflows.ts` 解析 provider 与导入；`StoryStore` 的 workflow 增删改查与引用计数；`images workflow import|list|show|delete` CLI；server 的 provider/workflow 接口与 `--images` 参数。
- M6-T02：`images/types.ts` 的 `CharacterVisualProfile` 与严格校验；`images/profiles.ts` 的 `visual_profile` 后台任务（故事级、gap 档、档案为空才运行、按人物覆盖）；`images/prompt.ts` 的 `compileImagePrompt`（tags 与 natural，服装读台账，缺档案人物进 `missingProfiles`）；`StoryStore` 的视觉档案方法；`images profiles` CLI；`GET /api/stories/:id/visual-profiles`；创建故事与导入卡后入队。
- M6-T03：
  - 故事设置 `imageConfig`（`story_settings.image_config`）：`mode` 取 `off`、`manual`、`auto`（默认 `off`），`workflowId`（默认空），`maxPerFloor` 1–4（默认 1），`minFloorsBetween` 0–100（默认 3）；`assertStorySettingsUpdate`、`STORY_SETTINGS_UPDATE_KEYS`、旧记录默认值都已接入。`StorySettings.imageConfig` 会出现在 `GET /api/stories/:id/settings` 与 `PUT` 请求里。
  - `images/request.ts` 的 `validateImagePromptRequest` 是 `illustrate` 参数的唯一校验口：只允许 `characters`、`scene`、`shot`、`mood`，`scene` 1–500 字，人物最多 4 个且名字非空，`shot` 取 `close-up`、`medium`、`wide`、`scenery`。
  - `images/tool.ts`：`ILLUSTRATE_TOOL` 与 `ILLUSTRATE_TOOL_NAME = "illustrate"`；`resolveIllustrateTool` 只在 `mode === "auto"`、`workflowId` 非空且 workflow 存在、`providerConfigured !== false` 时返回工具；`applyIllustrateCalls` 在写楼层的同一事务里校验参数、模式、workflow、provider、每楼上限与间隔，接受的调用写 `node_images` 的 `pending` 行并生成 seed，拒绝只记录原因。`IllustrateTurnOptions` 是 `ImageConfig` 加 `providerConfigured?` 与 `seed?`。
  - `runModelTurns` 新增 `sideEffectTools`：工具定义进入两种传输的 tools 列表，但不进入读取工具集合、不执行，参数随 `toolCalls` 返回；文本协议在混合读取轮里对已知侧效应工具回 `"已登记，后台会处理。"`，未知工具仍然拒绝。
  - `generateAssistantTurn` 新增 `illustrate?: IllustrateTurnOptions`。Trace 新增可选 `images: { accepted, rejected }`；`tools.calls` 包含 illustrate 的接受与拒绝；被拒绝的调用不写行，楼层照常保存。
  - `images/queue.ts`：`ILLUSTRATE_JOB_KIND = "illustrate"`，故事级、gap 档、`needsRun` 为当前 head 路径上存在 `attempts < 3` 的 pending 行；处理器按创建顺序每次最多处理 `IMAGE_BATCH = 2` 行，读 workflow、provider、楼层状态快照与视觉档案，编译 tags 提示词，标 running，调用 provider，把文件写到 `<mediaDir>/<storyId>/<imageId>.<扩展名>`，读图片头得到宽高后写 `done`；单行失败只累计该行 `attempts`，第三次标 `failed`，其它行继续。`IMAGE_MAX_ATTEMPTS = 3`。
  - `images/client.ts`：`ImageProviderClient`、`ImageClientFactory`、`createDefaultImageClientFactory`；第一批只有 ComfyUI 适配。`images/media.ts`：`imageExtensionOf` 与 `readImageDimensions`（PNG、GIF、WebP 的 VP8/VP8L/VP8X、JPEG）。
  - `StoryStore` 新增：`listNodeImages`、`listStoryNodeImages`、`listPendingNodeImages`、`getNodeImage`、`countNodeImages`、`listNodeImageNodeIds`、`insertNodeImage`、`startNodeImage`、`finishNodeImage`、`failNodeImage`、`requeueRunningNodeImages`、`retryNodeImage`。图片只能挂在助手楼层，`story_id` 与楼层一致由触发器保证。
  - 手动入口：`POST /api/nodes/:id/images`（当前 head 路径上的助手楼层；`mode` 为 `off` 返回 409；workflow 或 provider 缺失返回 409；校验请求后写 pending 行并入队，不调用后端）与 `POST /api/images/:id/retry`（只接受 `failed`，退回 pending 并清零 attempts）。CLI：`dramaticer images generate --node <id> --scene <文本> [--characters a,b] [--shot <镜头>] [--mood <气氛>] [--db <路径>]`、`dramaticer images list --node <id> [--db <路径>]`。
  - server 与 `dramaticer work`：启动时调用 `store.requeueRunningNodeImages()`（把 running 行退回 pending）；注册 illustrate 处理器并传入 `ImagesConfig` 与 `mediaDir`；server 新增 `--media-dir`（默认数据库同目录的 `images/`），work 新增 `--images` 与 `--media-dir`。server 没有生图配置时不注册 illustrate 任务。
- M6-T04：
  - protocol：`NodeImage`（`id`、`nodeId`、`ordinal`、`status`、`url`、`width`、`height`、`error`）与 `NodeImagesView` 在 `packages/protocol/src/images.ts`；`StoryPathNode` 在 `packages/protocol/src/story.ts`，`TimelineNode` 加 `images`，`StoryPath.nodes` 与所有返回路径的接口都用它。
  - `StoryStore.listNodeImagesForNodes(nodeIds)`：一条 `IN (...)` 查询按 `node_id`、`ordinal` 排序；`routes.ts` 的 `toPathNodes` 按整页节点一次取图，`buildPath` 与 path 接口共用。`GET /api/nodes/:id/images` 返回 `{nodeId, images}`；`url` 只在 `done` 时是 `/api/images/<id>/file`。
  - `GET /api/images/:id/file`：只读 `done` 行，只接受 `image/png`、`image/jpeg`、`image/webp`、`image/gif`；`resolve` 后检查仍在 `imagesMediaDir` 内，再比较 `realpath` 防止软链接越界；未完成、失败、缺失、越界一律 404，响应不含文件系统路径；接口需要登录。
  - `ApiRouteOptions`/`HandlerOptions` 新增 `imagesMediaDir`，server 用 `images?.mediaDir ?? <数据库目录>/images` 传入。
  - web：`api.getNodeImages` 与 `api.retryImage`；`chat/node-images.ts` 的 `isImagePending`、`nodesWithPendingImages`、`applyNodeImages`、`shouldPollNodeImages`（2 秒、15 次）；`FloorImages` 渲染缩略图、占位“正在生成插图……”、失败原因与重试；`ImageZoom` 从 `SandboxBlock` 抽出共用；轮询只针对当前路径上未完成图片的楼层。
- M6-T05：
  - 新增 `packages/web/src/pages/story/ImagesPage.tsx`，路由 `stories/:storyId/images`，导航标签“生图”。页面加载 `GET /api/images/providers`、`GET /api/images/workflows`、`GET /api/stories/:id/visual-profiles`；provider 只显示 `id`、`api`、`baseUrl`、是否配置，不显示密钥。
  - 导入流程：文件输入读取本地 JSON，`parseWorkflowText` 只做 JSON 语法检查，随后 `POST /api/images/workflows/detect`；五个插槽下拉框从 `candidates` 取值，正向提示词与 seed 必选，其余可不使用；`resolveImportSlots` 校验后调用 `import`，成功后重新取 workflow 列表；删除走 `DELETE /api/images/workflows/:id`，409 的原因显示在 `settings-errors`。
  - 视觉档案：显示人物、基础外貌、默认服装、负向标签、来源与更新时间；新增 `POST /api/stories/:id/visual-profiles/generate`，`requireStory` 后无条件入队 `visual_profile`（已有档案也覆盖），返回 202 的 `{storyId, jobId, kind}`，由 `scheduler?.schedule` 触发；“刷新档案”重新读取。
  - 设置页：新增“生图”区段，`mode`、workflow 下拉、`maxPerFloor`、`minFloorsBetween`；设置页加载时并行取 `GET /api/images/workflows`，已删除的 workflow id 仍显示为“已删除的 workflow（id）”。
  - `packages/web/src/chat/image-form.ts`：`buildImageSettingsDraft`、`parseImageSettingsDraft`（范围与 core 的 `assertImageConfig` 一致；`mode` 非 `off` 且 workflow 为空时报 `imageConfig.workflowId`）、`describeImageConfigPath`、`describeImageErrorPath`、`workflowNameFromFile`、`parseWorkflowText`、`defaultSlotSelections`、`resolveImportSlots`、`slotRefLabel`。`settings-form.ts` 的 `SettingsFormDraft` 增加 `image`，`parseSettingsDraft` 合并 `imageConfig` 与错误，`describeSettingsPath` 委托生图路径中文名。
  - 测试：`packages/web/test/image-form.test.ts` 10 个；`settings-form.test.ts` 的往返断言包含 `imageConfig`；`packages/server/test/images.test.ts` 新增生成入队用例（已有档案仍入队、缺失故事 404）。冒烟脚本 `.devloop/scratch/M6-T05/smoke.mjs` 用真实 server + Playwright 验证导入、保存、刷新、409、重新生成、设置保存、关闭模式、390×844 无横向溢出与界面无密钥。
- M6-T99：真实 ComfyUI 验收，见 HUMAN-15。需要跑一张卡的开场图与一次剧情图，核对失败重试、频率设置与图片块显示，写 `docs/dev/reports/M6.md`，并跑 `pnpm check` 与 `pnpm e2e`。
- 生成文件目录：数据库文件同目录的 `images/`，可用 server 的 `--media-dir` 或 work 的 `--media-dir` 覆盖；`node_images.file_name` 存相对路径 `<storyId>/<imageId>.<扩展名>`。
- 导演规则触发出图不在第一批；第一批取得真实出图数据后另立任务。

## M6b 生图第二批
- 排在 R6-T99 之后：M6b-T01 OpenAI 兼容图像接口、M6b-T02 Grok 图像接口、M6b-T03 NovelAI 图像接口（ZIP 解压依赖届时登记）、M6b-T99 验收。
- 共用第一批的 `ImageProviderClient`、`images.yaml`、`node_images`、媒体接口与显示路径；只增加后端适配与自然语言提示词。

## R5 验收结果
- 统计版 `docs/dev/reports/R5-playtest.md` 与验收报告 `docs/dev/reports/R5.md` 来自 2026-11-09T12:58:33Z 从空数据库与空续跑文件启动的重跑；续跑文件 `eval-private/reports/r5-playtest.progress.json` 有 60 条 round 记录、0 条 failure；两份报告在 14:53:16Z 生成。
- 统计版：60 成功 / 0 失败；相邻块 Jaccard 均值 0.0019、P90 0.0031（599 对）；首字 P50 5,176、P95 10,150 毫秒；生成 P50 10,094、P95 16,905 毫秒；每轮 prompt / completion / total / reasoning token 为 7,515.8 / 666.7 / 8,971.8 / 250；导演决策 60、有建议 60，机制命中 beat 59、clue 46、opening 12、pacing 7、event_pool 0、repetition 0；新建线索 23、兑现 0；错误数 0；选择信号 swipe 2、choice 0、edit 2、card_decision 0；私有标识反向扫描通过（804 个标识）。
- 操作排期在 3–10 轮：swipe 2 次、edit 2 次、branch 2 次；候选行动面板在第 7、12、36 轮读到 5 条，其余 57 轮读到 0；排期轮次没有出现选项块。
- 数据库最终快照：`background_jobs` 为 `done=786`、`pending=5`、`running=1`、`discarded=2`、`failed=5`。按种类：`settle` 完成 63、待执行 1；`candidate_actions` 完成 56、失败 5、丢弃 2、待执行 1；`scene` 完成 63、待执行 1；`embeddings` 完成 118、运行中 1；`events`、`npc_agenda`、`summary` 各完成 119；`memory_revision` 完成 63、待执行 1；`user_will` 完成 63、待执行 1；`opening`、`director_plan`、`opening_candidates` 各完成 1。
- 候选行动 56 个楼层各 5 条，共 280 行；当前 head 路径上 52 个楼层有候选。5 条失败全部是「候选行动.actions 必须正好 4 条，实际为 5 条」，按严格解析失败计数。拍状态 51 行（当前路径 45 行），结算记录 63 行（当前路径 57 行）；`preference_events` 为 `swipe` 2 与 `edit` 2。
- `scene` 在 R5-T14.e 修复后 63 条完成、0 失败、0 丢弃、1 待执行；修复前的 17 条空输出失败只作历史对照。
- 监督进程已完成并停掉 server：`supervisor.json` 状态 `completed`，pid 71688，`startedAt` 14:39:48Z。**不要再启动第二个监督进程或 server。** 60 轮数据库与续跑文件保留在 `.devloop/scratch/R5-T14/live.db` 与 `eval-private/reports/r5-playtest.progress.json`。

## 后台任务与队列
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。`schedule` 的 drain 只跑 `resolveStoryBackgroundKinds` 过滤后的类型，并带 `sessionEnded: true`，所以每轮结束后延后档（事件、摘要、NPC 议程、导演计划）也会执行。
- 后台任务恢复：`requeueRunningBackgroundJobs(storyId?)` 把 running 行退回 pending、`attempts` 减一（不低于 0）、清空 `started_at` 与 `finished_at`、保留 `last_error`；`startServer` 打开数据库后调用一次，`dramaticer work` 在列出故事前调用一次。`requeueRunningNodeImages(storyId?)` 把 `node_images` 的 running 行退回 pending，不改 attempts；两处启动同样调用一次。
- 故事级任务入队：`StoryStore.enqueueStoryBackgroundJobs` 按种类写入 `node_id` 为空的 `background_jobs` 行；创建故事与导入卡的路由先调用 `enqueueOpeningBackgroundJobs`（按两个 `needsRun` 过滤）再 `enqueueVisualProfileBackgroundJob` 再 `schedule`。`POST /api/stories/:id/openings/generate` 无条件入队一条 `opening_candidates`；`POST /api/stories/:id/visual-profiles/generate` 无条件入队一条 `visual_profile`，两者都只要求故事存在。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`、`director_plan`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`candidate_actions` 是 `gap` 档。后台任务连续失败 3 次才放弃；需要等待其它任务时抛出 `BackgroundJobDeferredError`。`deferBackgroundJob` 把状态退回 `pending`、`attempts` 减一、`started_at` 清空。
- `drainBackgroundJobs` 每轮按 `created_at ASC, id ASC` 取最多 `limit` 条 pending，先丢弃不在当前 head 路径上的楼层任务，再逐个执行；`BackgroundScheduler` 同一时刻只有一个 pump。服务端日志行格式：`后台任务 <storyId>：新增 N 条，执行 N 条（失败 N，丢弃 N）`。`limit` 默认 20。
- `enqueueMissingBackgroundJobs` 的入队候选只来自 `getPathToHead`（R5-T14.c）；故事级任务按 `story_id + kind` 唯一，已完成、失败或丢弃的行翻回 `pending`。
- 故事级任务的 `needsRun` 在每次 drain 时重新判断；完成的行会因为没有需要而不再翻回。`illustrate` 的 `needsRun` 只看当前 head 路径上 `attempts < 3` 的 pending 图片行；`visual_profile` 只在对素材存在且档案表为空时为真；手动入队的 pending 行会直接执行，不受 `needsRun` 影响。
- `illustrate` 任务的批次上限是 `IMAGE_BATCH = 2`，单行失败上限 `IMAGE_MAX_ATTEMPTS = 3`。workflow 或 provider 缺失属于任务级错误：任务失败、行保持 pending，配置补上后任务行会被 `needsRun` 翻回 pending 继续。

## 导演与候选行动
- 导演计划接口：`readDirectorPlan` 按 `ordinal` 还原弧线、序列、节拍；`--set` 与 `PUT /api/stories/:id/director/plan` 都整份替换并把所有行标为 `player`，`mergePlannedArcs` 只更新或追加 `model`/`import` 行，永不删除、不覆盖 `player` 行。`resolveCurrentBeat` 沿路径最近一条 `director_beat_states` 前进；`readDirectorPlan` 与 `resolveCurrentBeat` 的入参是 `Pick<StoryStore, …>`。
- 导演规划器（R4-T02）：`directorPlanNeedsRun` 需要角色卡或台账素材；计划为空时补建，head 上 `resolveCurrentBeat` 返回 null 时补建，head 为空或当前拍仍可解析时不补建。`plannerClient` 在 `dramaticer work` 与 server 里用 `roles.planner` 建立，缺省回退到 `background`。
- 导演强度与注入（R4-T03、R4-T04）：`DirectorConfig.intensity` 与 `openingIntensity` 共用 `DirectorIntensity`；机制优先级固定为重复正文 40、开场 35、线索过老 30、场景重复 25、节拍 23、线索过多 20、事件池 10、节奏 5；`createDirectorSlotProvider` 返回带 `config`、`mechanisms` 的 `DirectorSlotProvider`；组装器在预算裁剪后把 suffix 接在最后一条 user 消息末尾，Trace 记 `appendedTo: "last-user"`。
- 导演模式（R4-T05）：`DirectorConfig.mode` 取 `off`、`transparent`、`blind`，默认 `transparent`。节拍完成检测（R4-T06）：结算窗口的 `beats` 按楼层父节点解析；模型没有给该楼层条目、楼层被拒绝、或按路径解析出的拍与提示词里的拍不同时不写状态。
- 候选行动（R4-T07）：`candidate_actions` 按 `settled` 为每个已生成完成的助手楼层建任务，档位 `gap`；`parseCandidateActionsResponse` 是唯一校验口；写入顺序固定为 4 条 `action` 再 1 条 `scene_change`；`GET /api/nodes/:id/actions` 只按楼层读取，不跟随 head。

## 界面与接口
- 分支与面板接口：`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`，`facts` 来自 `readLedgerFacts`，`diffs` 只含该楼层自己的写入。`GET /api/nodes/:id/events` 的 `limit` 默认 100、回显实际 `limit` 与 `offset`；`GET /api/nodes/:id/compressions` 返回 `{nodeId, compressions}`。
- 变更卡接口：`GET /api/stories/:id/proposals?status=` 默认 `pending`，接受 `all` 与四个状态；`POST /api/proposals/:id/approve|reject|rollback` 复用 core 的三个函数，返回 `{card, ledger}`。`LedgerChangeCardError` 的 `not_found` 映射 404、`invalid_status` 映射 409；批准玩家来源卡片会同时写 `userWill`；回滚只恢复 `before` 里的路径。
- 路径接口：`GET /api/stories/:id/path?nodeId=&limit=&before=`，返回 `{storyId, headNodeId, nodes, hasMore}`；`nodeId` 是锚点、缺省 head，锚点节点包含在返回路径里；`before` 必须在本故事且在该锚点的路径上，返回它之前的 `limit` 楼；`hasMore` 只在返回页之前还有楼层时为真。`limit` 必须在 1 到 200 之间。每个节点是 `StoryPathNode`：`TimelineNode` 的字段加 `images`；`images` 按 `ordinal` 排序，`url` 只在 `done` 时出现。整页图片由 `listNodeImagesForNodes` 一次查询。
- 生图接口：`GET /api/images/providers` 返回 `{providers:[{id, api, baseUrl, configured, timeoutMs, pollIntervalMs}]}`，不含 `apiKey`；`GET /api/images/workflows` 返回 `{workflows}`；`POST /api/images/workflows/detect` 请求 `{workflow}`，只返回 `{slots, candidates, unresolved}` 不写库；`POST /api/images/workflows/import` 请求 `{name, workflow, slots}`，缺插槽、插槽非法或 workflow 非法返回 400（`details.path` 为 `slots` 或 `workflow`），配置了多个 provider 时 400（`details.path` 为 `provider`）；`DELETE /api/images/workflows/:id` 被 `node_images` 引用时 409。`GET /api/stories/:id/visual-profiles` 返回 `{storyId, profiles}`，`profiles` 每项含 `storyId`、`character`、`profile`、`source`、`createdAt`、`updatedAt`。
- 生图手动入口：`POST /api/nodes/:id/images` 请求体与 `illustrate` 参数相同，返回 201 的 `NodeImageRecord`；`mode` 为 `off`、workflow 或 provider 缺失返回 409，参数非法返回 400（`details.path` 为 `request`），楼层不是助手或不在 head 路径上返回 400/409。`POST /api/images/:id/retry` 只接受 `failed` 行，返回 200 的 `NodeImageRecord`；不存在 404、其它状态 409。两者只写 pending 行并入队，不调用图像后端。
- 视觉档案生成（M6-T05）：`POST /api/stories/:id/visual-profiles/generate` 返回 202 的 `{storyId, jobId, kind}`，只入队；故事不存在 404。已有档案时同样入队，处理器执行时按人物覆盖同一行。
- 楼层图片读取：`GET /api/nodes/:id/images` 返回 `{nodeId, images}`，只要求楼层存在，供轮询。`GET /api/images/:id/file` 只返回 `done` 行，按 `media_type` 返回 PNG/JPEG/WebP/GIF；未完成、失败、文件缺失、`file_name` 越界或软链接越界都返回 404 `图片文件不存在`；接口需要登录，响应不包含文件系统路径。
- `server --images <路径>` 默认 `data/images.yaml`，`--media-dir <路径>` 默认数据库同目录的 `images/`；文件缺失时 provider 列表为空、illustrate 任务不注册。
- 分支接口的 head 语义：`appendNode` 自带把 head 移到新节点，所以 `swipeNode`、`editNode`、重新生成写完楼层后 head 已经是新楼层，不需要再调用 `POST /head`；`setHead` 只在树里主动切分支时使用。
- 块载荷：`DisplayedContent` 是协议层的渲染载荷，`display` 为 `null` 表示没有显示策略、按原文显示；`html` 模板的 `{{content}}` 由 web 用 `escapeHtml` 替换，模板字符串只进入 iframe 的 `srcdoc`。本地历史楼层仍然在客户端用 `parseBlocks(node.raw)` 再 `toDisplayedBlocks`。`图片` 块继续走沙箱模板；楼层图片是独立的附属数据显示，不进入 `parseBlocks` 结果。
- web 包结构：`src/api/{client,sse,index}.ts`；`src/chat/{path-state,virtual-window,stream-state,turn-summary,blocks,sandbox,candidate-actions,opening-candidates,branch-tree,ledger-view,proposal-view,director-view,composer-draft,settings-form,template-form,channels-form,node-images,image-form,format}.ts`；`src/playtest/{records,stats,report,user,progress}.ts`（纯逻辑，Node 与浏览器都可导入）；`src/components/…`、`src/pages/*`、`src/pages/story/*`、`src/styles.css`。`@dramaticer/core/blocks` 是浏览器安全子路径；web 的界面代码不要从 `@dramaticer/core` 根入口导入运行时函数（`src/playtest` 只导入类型）。
- 聊天页每轮生成完成后重新取最新 60 楼并丢弃旧的向上分页；`PAGE_SIZE` 60、分页阈值 240px、自动贴底阈值 96px、楼层高度估算 200px、overscan 600px。候选行动与开场候选的轮询间隔都是 2 秒、上限 15 次；两个面板在聊天面板里最高占 40vh。楼层图片轮询沿用 2 秒 / 15 次，只轮询当前路径上有未完成图片的楼层，手动重试后立刻刷新并重新开始轮询。
- 聊天页楼层图片：`ChatFloorView` 在正文后渲染 `FloorImages`；`done` 显示缩略图与 `ImageZoom`，`pending`/`running` 显示“正在生成插图……”，`failed` 显示 `error` 与“重试”。`ImageZoom` 是全屏 `<dialog>`（点击遮罩、关闭按钮或 Escape 退出），由 `SandboxBlock` 的图片块与楼层图片共用。楼层图片不进入块渲染器，也不修改原文。
- 生图面板：导航第七个标签“生图”，路由 `stories/:storyId/images`。文件名去掉 `.json` 作为默认 workflow 名称；detect 之后正向提示词与 seed 必须选择；保存成功清空识别状态但保留名称；删除请求期间禁用所有删除按钮；视觉档案按钮只入队，刷新按钮重新取档案。设置页的生图区段在“间隙后台”之后，workflow 下拉与面板共用 `GET /api/images/workflows`。
- 聊天页的回合模式取自 `GET settings` 的 `turnMode` 并作为 `mode` 发送；settings 尚未取到时按 `fast`。锁定为深回合时下拉框只显示当前值（不可选），旁边出现「切回快回合」按钮走 `PUT settings`；深回合不在可选项里（DESIGN §10.1）。
- 分支页：路径高亮按完整路径 id 集合；head 行用 `focusSignal` 触发 `scrollIntoView`（0 表示还没加载）。树里只有 `childIds.length > 0` 才能折叠；`describeHeadSwitch` 是切换提示的唯一文案来源。自动试玩编辑时先点 `.branch-row-head .branch-select`，等 `.branch-detail-raw` 出现再点「编辑正文」；分支切换按 `.branch-preview` 的精确文本定位兄弟节点，再「切换到此楼层」→「确认切换」。
- 台账页：楼层选择复用 `BranchTree`，`focusSignal` 固定 0；`selectedId` 变化时并行取 ledger、events 第一页与 compressions，`requestRef` 序号防止旧响应覆盖；故事级 clues/entities/lore 与 `proposals?status=all` 只在 storyId 变化时取一次。事件每页 20，下一页 offset 等于已收到条数，`appendEventPage` 按 id 去重。facts 的「写入时间」取树节点的 `createdAt`。
- 台账页变更卡：按状态分组展示，待审卡有批准与拒绝、已批准卡有回滚、已拒绝显示拒绝原因；`cardBusyId` 请求期间禁用全部按钮，`storyEpoch` 丢弃切故事后的响应。
- 导演页：楼层选择同样复用 `BranchTree`；`selectedId` 变化时并行取 `director`、`actions` 与 `trace`；故事级设置、计划与线索只在 storyId 变化时取一次。决策记录写在生成时的消息楼层上（助手楼层的父楼层），选中助手楼层时 `GET director` 通常返回 `decision: null`。盲盒模式下服务端省略整个 `signals`，前端不得推断指令。
- 导演页的计划编辑器直接操作 `DirectorPlan` 对象：新增条目的标题与拍内容为空，保存时由服务端 `parseDirectorPlan` 拒绝并返回字段路径；`ErrorNotice` 显示 `details.path`。保存成功后 `plan` 与 `draftPlan` 同时替换。
- 跨面板候选行动：`setComposerDraft(storyId, text)` 写入模块级 Map，导演页随后 `navigate` 到聊天页；`ChatPage` 用 `composerStoryRef` 保证每个故事只消费一次（StrictMode 会重复执行 mount effect），读取后立即清空。草稿不持久化，刷新丢失。
- 选择信号已闭环：记录写入（四种信号）→ `POST /api/nodes/:id/choice` → `preferences export` 产出回复对 → `pairwise` 盲测与评分 → `scoreboard` 汇总。重新生成与 `swipeNode` 都写 `swipe`；`editNode` 写 `edit`；`card_decision` 在批准与拒绝时由 `updateLedgerChangeCardStatus` 写入，回滚不写。
- 设置页（R5-T09）：`GET /api/stories/:id/template` 返回故事实际使用的模板；内置默认模板不能直接保存，先「复制为新模板并设为默认」再编辑。「故事使用的模板」下拉只改表单草稿。模板校验（`assertContextTemplate`）也校验 `when`；server 把模板校验错误映射为 `details.path: "template"`。
- 设置表单校验与服务端同一套范围：`budgetTokens ≥ 0`、`maxTokens ≥ 1`、`temperature` 0–2、`maxReadRounds ≥ 0`、`gapPlanSeconds ≥ 0`、导演参数范围见 `DIRECTOR_NUMBER_FIELDS`、生图参数范围见 `packages/web/src/chat/image-form.ts`；服务端错误路径由 `describeSettingsPath` 显示成中文名。
- 渠道角色（`writer`、`settler`、`planner`、`judge`）与消息角色不同；`createLlmClient` 校验 judge 与 writer 的模型家族不同。`resolveModelForRole` 缺省 writer→main、其余→background。模型 `enabled` 默认 true；停用后不能作为故事模型、角色目标或路由。
- 渠道管理接口（R5-T03、R5-T10）：三条路由只在 `channels.path` 存在时可用。`GET` 每次重读文件；`PUT` 是整份替换，没出现的渠道、模型、嵌入提供方与岗位都会被删除；`models` 里不写 `tools`/`probe`（保留原值），`enabled: true` 不写入文件。`POST /api/channels/probe` 的 `channel` 缺省取模型第一个渠道；通道创建或体检抛出错误时返回 400 `渠道体检失败：<原因>`，`details.path` 为 `alias`。`ServerChannelsOptions.env` 同时用于解析 `${VAR}` 与报告 `apiKeySet`；变量完全不存在时 `GET` 直接 400。运行时缓存指纹包含 `roles`。

## 回合、上下文与记忆
- 工具传输：`resolveToolTransport` 在未显式配置时按 `probe.functionCalling` 决定；文本协议是 `core/src/chat/tool-protocol.ts`，工具说明只插进发给模型的消息副本。e2e 的 writer 为确定性使用 `tools.transport: text`。M6-T03 的侧效应工具两种传输都支持。
- 写作规则：`WRITING_CONTRACT` 是四条原则；`protocol` 是固定 id 的静态段，`assertContextTemplate` 要求它是最后一个片段。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。`director` 槽位只返回 suffix；组装器的 suffix 用 `\n\n` 与玩家原文分隔，多个 suffix 之间用 `\n` 连接。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。`图片` 的显示策略是沙箱 HTML 模板。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是改动前行为。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点（ADR-0046），取**最旧的** N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点，读取该楼层结算后的台账快照与路径上最近 6 楼原文。`scene` 请求不传 `maxTokens`，使用模型声明的输出上限，正文长度由系统提示词约束（ADR-0079）。
- 结算提示词只在 `SettlementWindow.beats` 非空时提 `beatCompleted`；`beatCompleted` 非布尔时该楼层整条拒绝，修复记录的 `path` 是 `["-"]`。
- 回合模式的解析口只有 core 的 `resolveTurnMode`：单轮参数优先于故事设置，深回合直接抛出错误。server 在写楼层之前调用它，深回合返回 400，`details.path` 在请求给 `mode` 时是 `mode`，否则是 `turnMode`。程序不在任何条件下自动切换模式（I6）。
- `extensions.dramaticer` 有三个键：`events`、`npcs`、`arcs`；`arcs` 的校验全部复用 `parseDirectorPlan`，导入来源固定为 `import`。R4 验收的链路证据在 `packages/core/test/director-acceptance.test.ts` 与 `docs/dev/reports/R4.md`。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用；导演决策从助手楼层的父楼层读；`retrieval` 只在槽位真正注入内容时写进 Trace。`explain` 不受导演模式影响。
- 模型响应的磁盘缓存键包含 `max_tokens` **只在请求显式带 maxTokens 时**；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768。

## 评测与报告
- 自动试玩的 CLI 入口是 `pnpm --filter @dramaticer/st-compat playtest`（纯 CLI 试玩，不驱动界面）；界面自动试玩是 `pnpm playtest`（R5-T13），两者不要混淆。CLI 试玩的每轮顺序是读间隙积压 → 模拟用户 → `runChatTurn` → swipe/edit/branch → 间隙后台任务 → 一致性探针 → 每轮裁判 → 写记录。
- 界面自动试玩（R5-T13）：`pnpm e2e` 会收集但跳过 `e2e/playtest/playtest.spec.ts`；`pnpm playtest` 先构建再跑 mobile project；`PLAYTEST_LIVE=1` 时 `playwright.config.ts` 不启动假 server，baseURL 默认 8787，`.env` 在用例里加载；模拟用户取 `roles.settler` 模型；报告默认路径见 `config.ts`（Windows 大小写不敏感，冒烟两份报告文件名不能只差大小写）；失败截图在 `.devloop/scratch/e2e/playtest/screenshots`。分支切换按 `.branch-preview` 精确文本定位，编辑会加〔试玩编辑第N轮〕前缀，保证预览可区分。
- 自动试玩续跑（2026-11-09）：live 默认 `PLAYTEST_RESUME=1`；续跑文件默认 `eval-private/reports/r5-playtest.progress.json`，每轮写完写入磁盘，记录故事 id、数据库、渠道、标题、排期与全部轮次。续跑时复用故事，从上次编辑操作还原两个兄弟楼层，失败记录在下次运行时丢弃并重试该轮；跑满 60 轮才写最终报告。`PLAYTEST_RESUME=0` 新开一次，`PLAYTEST_TIME_BUDGET_MS` 控制单次调用预算（监督进程配置 20 分钟）。
- 单轮失败时 `runPlaytest` 记录 `kind: "failure"` 并跳出循环；`playtest.spec.ts` 在存在 failure 记录时抛出错误，所以该次调用退出码为 1；CLI 此时也会写一份含失败记录的中间报告。监督进程按 failure 记录累计连续失败次数，并自动丢弃该记录重试。模拟用户的输出上限是 4096。
- 会话外监督进程（R5-T14.a）：`scripts/r5-playtest-supervisor.mjs` 读 `.devloop/scratch/R5-T14/supervisor-config.json`；状态 `supervisor.json`、日志 `supervisor.log`、锁 `supervisor.lock`。它负责构建一次、启动 server、反复调用试玩直到 60 轮，完成后停掉 server。`baseUrl` 非空时复用已有服务（假 server 冒烟用）。监督进程 `maxConsecutiveFailures` 统计的是**以失败记录结束的调用次数**，同一轮重试两次会累计两次；本轮把 `.devloop/scratch` 配置从 3 调到 6。脚本本身未改。
- 统计版 `docs/dev/reports/R5-playtest.md` 已是 14:53:16Z 的 60 成功 / 0 失败最终版本；`docs/dev/reports/R5.md` 第一至三节与第七节已按最终数据库回填。
- F0 的私有产物：`eval-private/f0/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2 的产物：`docs/dev/reports/R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md`、`docs/dev/SCOREBOARD.md`；R4 的产物：`docs/dev/reports/R4.md`；R5 的产物：`docs/dev/reports/R5.md`、`R5-playtest.md`。
- 引用评测数字时：B1 必须同时说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；选择一致率当前没有样本。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- `eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。
- 记分牌重新生成（仓库根目录执行）：
  `node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
  或把同样参数交给 `pnpm --filter @dramaticer/st-compat scoreboard`；`pnpm --filter` 的工作目录是包目录，相对路径会按包目录解析。
- 记分牌日期取输入最新时间戳；输入都无时间戳时必须显式传 `--date`。
- B1 历史回放的入口是 `pnpm --filter @dramaticer/st-compat replay-eval`；分支点从导入历史的末端取，不跟随已生成的续写楼层；续跑用 `--resume`，只重算报告用 `--report-only`。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）；R2-T99 的分支点验证样本为第 401 楼、naive 档。
- `pairwise` 的样本语境是两份续写的共同父楼层路径（最近 6 楼）；B1 用同一个 `formatPairwiseContext`。评分提示词的 system 段包含 `TTCW` 字样，测试里的假客户端靠它区分判定请求与评分请求；改提示词时同步 `pairwise.test.ts`、`historical-replay.test.ts` 与 `scoreboard.test.ts`。
- 质量评分同样本同一侧有多行时取最后一行；失败记录只计数，不进入均值。
- `preferences export` 的 `--db` 是必填；选项选择按所选正文与同一选项块里未选中的行配对，重 roll 按被放弃与被接受楼层配对。选项行切分统一用 core 的 `readOptionLines`。
- 遗忘评测（R2-T09.a）：`playtest --head` 只接受当前故事里存在的助手楼层，且不能与 `--resume` 同时使用；跑后批测必须同时给 `--questions-out` 与至少一个题目文件，题目文件里的 `story` 必须与 `--story` 一致。证据楼层不在当前路径上的题目记 `skipped`；遗忘分层固定为 `<100`、`100-199`、`200-299`、`300+`。
- `forgetting-report` 的 `--input` 可以是一个 JSON 或包含 JSON 的目录。
- legacy 导入与运行驱动在 `scripts/r2-legacy-forgetting.mjs`：`import`、`branches`、`run`、`run-all`、`finalize`；续跑必须带 `--resume true`。
- 基准的入口是 `pnpm --filter @dramaticer/st-compat benchmark --generate|--validate|--import --db <path>`；`benchmarks/` 是生成产物，**不要手改**。
- 开局包的读取入口是 `readOpeningPack(store, storyId)`；校验用 `validateOpeningPackPayload(value, known)`；首楼候选解析用 `parseOpeningCandidatesResponse(text, expectedCount)`。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。数据库或文件系统测试必须显式设置超时（`it("…", { timeout: 30_000 }, async () => …)`）；`afterEach` 删除临时目录用 `rmSync` 时带 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录会被测试创建；它们在 gitignore 里，不要提交。
- `packages/st-compat` 与 `packages/server` 在测试里通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这两个包的测试前先执行 `pnpm run typecheck`。
- 沙箱消息的浏览器约束：srcdoc 沙箱在不带 `allow-same-origin` 时 `event.origin` 是字符串 `"null"`，读 `document.cookie` 会直接抛出 `SecurityError`；Playwright 里要捕获这个异常。
- 聊天页、分支页、台账页、导演页、设置页与渠道页的手工冒烟脚本在 `.devloop/scratch/R5-T08`、`R5-T09`、`R5-T10`；M6-T04 的楼层图片冒烟在 `.devloop/scratch/M6-T04/smoke.mjs`；M6-T05 的生图面板与设置冒烟在 `.devloop/scratch/M6-T05/smoke.mjs` (`startServer` + Playwright，数据库、workflow 文件与截图都在该目录)。`playwright-core` 在 `E:/agentcoding/node_modules` 可解析，Chromium 在 `%LOCALAPPDATA%/ms-playwright/chromium-1243/`。
- e2e 的假渠道细节（R5-T12）：`serve.mjs` 用固定端口 4517，`playwright.config.ts` 的 baseURL 与 webServer 都读 `E2E_APP_PORT`；假渠道用随机端口并写进每次重建的 `channels.yaml`。数据库固定在 `.devloop/scratch/e2e/work/e2e.db`，测试直接用 `node:sqlite` 读 `preference_events` 或插变更卡；Playwright 的 `page.request` 与浏览器共享登录 cookie。`vitest.config.ts` 必须继续排除 `packages/web/e2e/**`（但 `packages/web/src/playtest` 与 `packages/web/test/playtest-*` 的纯逻辑测试会进入门禁）。`@playwright/test` 固定 1.63.0，浏览器 revision 1243 已在本机，不要再升级到需要新浏览器的版本。
- `.devloop/scratch/` 已被 git 忽略，e2e 的临时数据库、截图与 trace、自动试玩的报告与截图都在里面。
- Vertex 渠道（V-T01）：`api: google-vertex` 使用 pi-ai 1.5.0 的 `google-vertex` 适配器；`gemini-4-argon` 模型在 `data/channels.yaml` 与示例里，凭证、项目、区域只从 `.env` 的三个 `GOOGLE_*` 变量读取，服务账号 JSON 不进仓库；未设置时不影响现有渠道。live 验证用 `DRAMATICER_VERTEX_LIVE=1` 运行 `packages/core/test/google-vertex.live.test.ts`。
- 生图（M6-T01 至 M6-T05）：`images.example.yaml` 是配置模板；`data/images.yaml` 缺失时 provider 列表为空、导入拒绝、illustrate 任务不注册。workflow 存在 `image_workflows`，同名导入更新同一行；插槽由 `detectComfyUiSlots` 识别，多采样器或缺少正向/seed 时必须显式传 `slots`。ComfyUI 客户端接受注入的 `fetch`、`sleep`、`now`，单元测试零网络。视觉档案存在 `character_visual_profiles`，同一故事同一人物一行；`normalizeEntityName` 是重复判定与人物已知判定的共同规范化。`node_images` 的 `file_name` 是相对路径，实际文件在 `mediaDir` 下；`readImageDimensions` 只支持 PNG、GIF、WebP、JPEG。生图面板的 `parseWorkflowText` 只检查 JSON 语法，结构由 `detect` 校验；插槽选择以候选下标存字符串。真实 ComfyUI 的启动与 workflow 文件见 HUMAN-15。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包。

## 下一步
- M6-T99 需要 HUMAN-15 就绪（ComfyUI 在 8188 与 API workflow JSON）。若仍不可用，按 HUMAN.md 的阻塞规则把 M6-T99 标为 `[!]`，然后选 R1 续的第一个任务 R1-T03.a（依赖 M2-T08、M2-T10、R5-T99，均已满足；迁移从 v35 开始）。
- R1 续的任务（R1-T03.a、R1-T03.b、R1-T04.b、R1-T05、R1-T06、R1-T08）等 M6 第一批完成后再开始；迁移编号为 v35–v38。先读 R2-T09 与 R5-T14 报告决定默认开关。C 线兼容插件任务依赖 P2，C-T02 已补上预设兼容报告的要求；插件系统以 DESIGN §19 为唯一权威。
