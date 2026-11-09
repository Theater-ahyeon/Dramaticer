# 交接

> 每个会话结束前都要**完整重写**这个文件，不要往后追加。

## 最近一次会话
- 2026-11-09 会话 265：M6-T99 因 HUMAN-15 未就绪（`127.0.0.1:8188` 拒绝连接）标为 `[!]`，改做 R1-T03.a 并完成。迁移 v35 给 `chunks` 增加 `parent_ordinal` 与 `parent_text`，清空旧块、全文索引与块向量，并把 `embeddings` 任务退回待执行；`chunkTextByParent` 按段落边界合并父段（上限 1200 个码点，单段超限时整楼退化成一个父段），小块沿用 400/80；`StoryStore.open` 新增 `chunkStrategy`，默认 `parent-child`，`fixed` 与旧分块逐条一致；`searchChunks` 按楼层与父段排名并返回父段，`searchVectors` 关联块表返回父段；融合按楼层去重时保留第一条父段文本，记忆槽位与 `memory_search` 注入父段，Trace 的 `injected` 记录父段或整楼；ADR-0083 按 R2-T09 的 legacy native 同题矛盾率上升（66.7% → 100.0%）决定默认开启；新增 10 个测试，门禁通过（159 个测试文件、1419 个测试、4 个 live 跳过）。
- 会话 264：完成 M6-T05（生图设置与 workflow 管理界面）。新增 `packages/web/src/pages/story/ImagesPage.tsx` 与“生图”导航/路由：provider 状态（只读地址、不显示密钥）、本地 JSON 导入、`detect` 识别结果与五个插槽下拉确认、`import` 保存、被引用删除时显示 409 原因、视觉档案列表与“重新生成”。新增 `POST /api/stories/:id/visual-profiles/generate`（只入队，已有档案也允许覆盖）；协议新增 `StoryVisualProfileGenerateResult`，web `api` 增加 provider/workflow/档案方法。设置页加载 workflow 下拉并把 `imageConfig` 接入表单；`packages/web/src/chat/image-form.ts` 负责 workflow 文本解析、插槽选择与校验、生图设置范围校验和错误路径中文名，新增 10 个测试与 1 个 server 用例；390×844 生图页与设置页 Playwright 冒烟通过。
- 会话 263：完成 M6-T04（楼层图片显示与媒体接口）。`StoryPath` 的节点改为 `StoryPathNode`，path 与节点图片接口返回按 `ordinal` 排序的 `NodeImage`，整页图片用 `listNodeImagesForNodes` 一次查询；新增 `GET /api/images/:id/file`；聊天页新增图片区、2 秒 15 次轮询、失败重试与共用放大层。

## 当前状态
- 已完成：F0 全部、M0、M1、M2、M3、D、M4-T00 至 M4-T06、R0、R1 最小集（含 R1-T07.b.d.a 与 R1-T07.b.d.b）、R3、O、R2、E、R4、R5 全部（含 R5-T99）、V-T01、M6-T00 至 M6-T05、R1-T03.a。完成记录见 `docs/dev/TASKS-archive.md` 与 `docs/dev/TASKS.md`。
- **下一个任务：R1-T03.b 重排序**，依赖 R1-T03.a（已完成）与 M2-T10（已完成）。M6-T99 已标 `[!]`，等待 HUMAN-15：真实 ComfyUI 启动在 `http://127.0.0.1:8188` 并提供 API 格式 workflow JSON 到 `eval-private/comfyui/`；2026-11-09 探测时端口仍未监听。
- v3 阶段顺序：R5（已完成）→ M6 生图第一批（T01–T05 完成，T99 阻塞）→ R1 续（T03.a 完成）→ R3b 深回合 → P1/P2 → C 兼容插件 → H → X → R6 → M6b 生图第二批 → P3/P4 → M5 → P5 → M7。
- 人类已确认的路线变更：ADR-0038、ADR-0039、ADR-0040、ADR-0041（A1–A11）、ADR-0042、ADR-0043、ADR-0044、ADR-0045、ADR-0078、ADR-0079、ADR-0080、ADR-0082、ADR-0083。
- HUMAN-03 待处理（不阻塞）：抽查 `eval-private/evalset/spotcheck.md` 里的事件题。
- HUMAN-14 待处理（不阻塞）：Vertex 真实调用还需要人类把服务账号 JSON 导出到仓库外，并在 `.env` 设置 `GOOGLE_APPLICATION_CREDENTIALS`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`。
- HUMAN-15 待处理（M6-T99 需要）：把秋叶整合包 v3.2 的 ComfyUI 启动在 `http://127.0.0.1:8188`，并导出一份 API 格式 workflow JSON 到 `eval-private/comfyui/`。
- HUMAN-12 已完成：人类确认保持 `judge`（`auto/glm-5.3`）作为裁判路由。HUMAN-13 已关闭：`writer` 继续用 `main-fallback`。HUMAN-11 已完成：`.env` 的正文模型已改为 `auto/deepseek-v4.1-flash`。
- 数据库 schema 版本 35（v19 结算记录、v20 实体候选与置信度、v21 现场分析、v22 历史块策略、v23 事件抽取记录、v24 变更卡、v25 合并调用开关与执行记录、v26 间隙档位阈值与丢弃状态、v27 合并调用丢弃条目、v28 回合模式与读取工具上限、v29 开局包与故事级后台任务、v30 首楼开场候选、v31 选择记录、v32 导演计划与拍状态、v33 导演候选行动、v34 生图表、v35 父子分块）。R1 续后续迁移为 v36–v38。

## R1 续：父子分块（已完成）与后续
- R1-T03.a 的块参数：父段上限 1200 个码点，按换行切段后合并；单个段落超过上限时整楼退化成一个父段。小块沿用 400 字符窗口与 80 字符重叠。
- `StoryStore.open(path, { chunkStrategy })` 取 `parent-child`（默认）或 `fixed`；`fixed` 使用旧的固定窗口，命中后不返回父段。切换策略不会自动重建已经存在的块，需要清空 `chunks`、`chunks_fts` 与 `chunk_vectors` 后重新打开。
- `chunks` 的 `parent_ordinal` 是父段在楼层内的序号，`parent_text` 是注入文本；`chunks_fts` 的 rowid 仍等于 `chunks.id`。迁移 v35 会清空三张表并把 `embeddings` 任务退回待执行。
- `searchChunks` 按 `node_id` 与 `parent_ordinal` 排名（旧分块按楼层排名），返回 `parentOrdinal` 与 `parentText`；`searchVectors` 在向量候选之后关联 `chunks` 返回同两个字段。
- `RetrievalHit` 增加 `parentOrdinal` 与 `parentText`；融合仍按楼层去重，保留第一条命中的父段文本。记忆槽位与 `memory_search` 优先使用父段文本，没有父段时退回整楼的 prompt 视图。
- Trace 的 `context.entries[].retrieval.injected` 记录每次注入的 `{nodeId, kind, scope, parentOrdinal}`，`scope` 取 `segment` 或 `floor`；旧 Trace 没有这个字段。`dramaticer explain` 的检索段会显示“注入父段/注入整楼”。
- 下一步 R1-T03.b：新增 `RerankClient`（OpenAI 兼容 `POST /rerank`），渠道写在 `data/channels.yaml` 的 `reranker` 段；`retrieveMemory` 融合后取前 `rerankCandidates`（默认 20）重排，再取 top-K；开关默认关闭，由 R1-T04.b 的记忆评测决定。

## M6 生图第一批
- 顺序：M6-T01 至 M6-T05（已完成）→ M6-T99（阻塞）。
- 配置：`data/images.yaml` 只有 `providers`，第一版只接受 `api: comfyui`；`baseUrl`、`apiKey`、`timeoutMs` 默认 300000、`pollIntervalMs` 默认 1000；文件不存在返回空配置。workflow 存 `image_workflows`，同名导入更新同一行；插槽由 `detectComfyUiSlots` 识别。
- `imageConfig` 存在 `story_settings.image_config`：`mode` 取 `off`、`manual`、`auto`（默认 `off`），`workflowId` 默认空，`maxPerFloor` 1–4，`minFloorsBetween` 0–100。只有 `auto` 向模型提供 `illustrate` 工具。
- `illustrate` 是侧效应工具：回合事务内校验参数、模式、workflow、provider、每楼上限与间隔，接受的调用写 `node_images` 的 `pending` 行并生成 seed；后台 `illustrate` 任务每次最多两张，单行失败三次标记 `failed`。
- `POST /api/nodes/:id/images` 手动登记；`POST /api/images/:id/retry` 只接受 `failed`；两者只写 pending 行并入队。`GET /api/images/:id/file` 只读 `done` 行，按 `media_type` 返回 PNG/JPEG/WebP/GIF，越界或文件缺失一律 404。
- 生成文件写到数据库同目录的 `images/`，可用 `--media-dir` 覆盖；`node_images.file_name` 是相对路径 `<storyId>/<imageId>.<扩展名>`。
- 视觉档案存 `character_visual_profiles`，同一故事同一人物一行；`POST /api/stories/:id/visual-profiles/generate` 无条件入队，已有档案也覆盖。
- M6-T99 需要跑一张卡的开场图与一次剧情图，核对失败重试、频率设置与图片块显示，写 `docs/dev/reports/M6.md`。

## M6b 生图第二批
- 排在 R6-T99 之后：M6b-T01 OpenAI 兼容图像接口、M6b-T02 Grok 图像接口、M6b-T03 NovelAI 图像接口（ZIP 解压依赖届时登记）、M6b-T99 验收。
- 共用第一批的 `ImageProviderClient`、`images.yaml`、`node_images`、媒体接口与显示路径；只增加后端适配与自然语言提示词。

## R5 验收结果
- 统计版 `docs/dev/reports/R5-playtest.md` 与验收报告 `docs/dev/reports/R5.md` 来自 2026-11-09T12:58:33Z 从空数据库与空续跑文件启动的重跑；续跑文件 `eval-private/reports/r5-playtest.progress.json` 有 60 条 round 记录、0 条 failure。
- 统计版：60 成功 / 0 失败；相邻块 Jaccard 均值 0.0019、P90 0.0031（599 对）；首字 P50 5,176、P95 10,150 毫秒；生成 P50 10,094、P95 16,905 毫秒；每轮 prompt / completion / total / reasoning token 为 7,515.8 / 666.7 / 8,971.8 / 250；导演决策 60、有建议 60，机制命中 beat 59、clue 46、opening 12、pacing 7、event_pool 0、repetition 0；新建线索 23、兑现 0；错误数 0；选择信号 swipe 2、choice 0、edit 2、card_decision 0；私有标识反向扫描通过（804 个标识）。
- 数据库最终快照：`background_jobs` 为 `done=786`、`pending=5`、`running=1`、`discarded=2`、`failed=5`。按种类：`settle` 完成 63、待执行 1；`candidate_actions` 完成 56、失败 5、丢弃 2、待执行 1；`scene` 完成 63、待执行 1；`embeddings` 完成 118、运行中 1；`events`、`npc_agenda`、`summary` 各完成 119；`memory_revision` 完成 63、待执行 1；`user_will` 完成 63、待执行 1；`opening`、`director_plan`、`opening_candidates` 各完成 1。
- 候选行动 56 个楼层各 5 条，共 280 行；当前 head 路径上 52 个楼层有候选。拍状态 51 行（当前路径 45 行），结算记录 63 行（当前路径 57 行）。
- **不要再启动第二个监督进程或 server。** 60 轮数据库与续跑文件保留在 `.devloop/scratch/R5-T14/live.db` 与 `eval-private/reports/r5-playtest.progress.json`。

## 后台任务与队列
- server 的回合路径会补建并执行后台任务：`handleTurnStream` 在 `turn.completed` 之后调用 `BackgroundScheduler.schedule`，不等待 drain；同一时刻只有一个 drain，故事之间先来先做。
- 后台任务恢复：`requeueRunningBackgroundJobs(storyId?)` 把 running 行退回 pending、`attempts` 减一（不低于 0）、清空 `started_at` 与 `finished_at`、保留 `last_error`；`startServer` 与 `dramaticer work` 各调用一次。`requeueRunningNodeImages(storyId?)` 把 `node_images` 的 running 行退回 pending，不改 attempts。
- 故事级任务：`enqueueStoryBackgroundJobs` 按 `story_id + kind` 唯一；`POST /api/stories/:id/openings/generate` 与 `POST /api/stories/:id/visual-profiles/generate` 只入队。
- 后台任务分两档：`gap` 每次间隙执行，`deferred`（`events`、`summary`、`npc_agenda`、`director_plan`）只在会话结束或间隙达到 `gapPlanSeconds` 时执行。`gap_pass` 默认关闭；`candidate_actions` 是 `gap` 档。连续失败 3 次才放弃。
- `drainBackgroundJobs` 每轮按 `created_at ASC, id ASC` 取最多 `limit` 条 pending，先丢弃不在当前 head 路径上的楼层任务；日志行格式：`后台任务 <storyId>：新增 N 条，执行 N 条（失败 N，丢弃 N）`。
- `illustrate` 的 `needsRun` 只看当前 head 路径上 `attempts < 3` 的 pending 图片行；`visual_profile` 只在对素材存在且档案表为空时为真。
- 迁移 v35 会把所有 `embeddings` 任务退回 `pending`，让后台按新的块补齐向量；打开旧数据库后第一次 drain 会处理它们。

## 导演与候选行动
- 导演计划接口：`readDirectorPlan` 按 `ordinal` 还原弧线、序列、节拍；`--set` 与 `PUT /api/stories/:id/director/plan` 都整份替换并把所有行标为 `player`，`mergePlannedArcs` 只更新或追加 `model`/`import` 行，永不删除、不覆盖 `player` 行。
- 导演强度与注入：机制优先级固定为重复正文 40、开场 35、线索过老 30、场景重复 25、节拍 23、线索过多 20、事件池 10、节奏 5；组装器在预算裁剪后把 suffix 接在最后一条 user 消息末尾。
- 导演模式：`DirectorConfig.mode` 取 `off`、`transparent`、`blind`，默认 `transparent`。落拍检测按楼层父节点解析；模型没有给该楼层条目、楼层被拒绝、或解析出的拍与提示词里的拍不同时不写状态。
- 候选行动：`candidate_actions` 按 `settled` 为每个已生成完成的助手楼层建任务，档位 `gap`；写入顺序固定为 4 条 `action` 再 1 条 `scene_change`；`GET /api/nodes/:id/actions` 只按楼层读取，不跟随 head。

## 界面与接口
- 分支与面板接口：`GET /api/nodes/:id/ledger` 返回 `{state, facts, diffs}`。`GET /api/nodes/:id/events` 的 `limit` 默认 100。`GET /api/nodes/:id/compressions` 返回 `{nodeId, compressions}`。
- 路径接口：`GET /api/stories/:id/path?nodeId=&limit=&before=` 返回 `{storyId, headNodeId, nodes, hasMore}`；每个节点是 `StoryPathNode`（`TimelineNode` 加 `images`），图片按 `ordinal` 排序。
- 生图接口：`GET /api/images/providers` 不含 `apiKey`；`GET /api/images/workflows`；`POST /api/images/workflows/detect` 只返回识别结果；`POST /api/images/workflows/import` 请求 `{name, workflow, slots}`；`DELETE /api/images/workflows/:id` 被引用时 409。
- 视觉档案：`GET /api/stories/:id/visual-profiles` 返回 `{storyId, profiles}`；`POST /api/stories/:id/visual-profiles/generate` 返回 202。
- 楼层图片：`GET /api/nodes/:id/images` 返回 `{nodeId, images}`；`url` 只在 `done` 时出现。`GET /api/images/:id/file` 需要登录，响应不含文件系统路径。
- `server --images <路径>` 默认 `data/images.yaml`，`--media-dir <路径>` 默认数据库同目录的 `images/`；文件缺失时 provider 列表为空、illustrate 任务不注册。
- 块载荷：`DisplayedContent` 是协议层的渲染载荷，`display` 为 `null` 表示按原文显示；`html` 模板的 `{{content}}` 由 web 用 `escapeHtml` 替换。
- web 包结构：`src/api/{client,sse,index}.ts`；`src/chat/{path-state,virtual-window,stream-state,turn-summary,blocks,sandbox,candidate-actions,opening-candidates,branch-tree,ledger-view,proposal-view,director-view,composer-draft,settings-form,template-form,channels-form,node-images,image-form,format}.ts`；`src/playtest/*` 是纯逻辑。
- 聊天页每轮生成完成后重新取最新 60 楼并丢弃旧的向上分页；`PAGE_SIZE` 60、分页阈值 240px、自动贴底阈值 96px、楼层高度估算 200px、overscan 600px。候选行动、开场候选与楼层图片轮询都是 2 秒、上限 15 次。
- 聊天页楼层图片：`done` 显示缩略图与 `ImageZoom`，`pending`/`running` 显示“正在生成插图……”，`failed` 显示 `error` 与“重试”。楼层图片不进入块渲染器，也不修改原文。
- 生图面板：导航第七个标签“生图”，路由 `stories/:storyId/images`。设置页的生图区段在“间隙后台”之后，workflow 下拉与面板共用 `GET /api/images/workflows`。
- 分支页：路径高亮按完整路径 id 集合；head 行用 `focusSignal` 触发 `scrollIntoView`。自动试玩编辑时先点 `.branch-row-head .branch-select`，等 `.branch-detail-raw` 出现再点「编辑正文」。
- 台账页：楼层选择复用 `BranchTree`；事件每页 20，`appendEventPage` 按 id 去重；变更卡按状态分组，批准与拒绝写 `card_decision`。
- 导演页：楼层选择复用 `BranchTree`；`selectedId` 变化时并行取 `director`、`actions` 与 `trace`；盲盒模式下服务端省略整个 `signals`。
- 设置页：模板校验也校验 `when`；服务端把模板校验错误映射为 `details.path: "template"`。表单校验与服务端同一套范围：`budgetTokens ≥ 0`、`maxTokens ≥ 1`、`temperature` 0–2、`maxReadRounds ≥ 0`、`gapPlanSeconds ≥ 0`、导演与生图参数按各自范围。

## 回合、上下文与记忆
- 工具传输：`resolveToolTransport` 在未显式配置时按 `probe.functionCalling` 决定；文本协议在 `core/src/chat/tool-protocol.ts`。e2e 的 writer 为确定性使用 `tools.transport: text`。
- 写作规则：`WRITING_CONTRACT` 是四条原则；`protocol` 是固定 id 的静态段，`assertContextTemplate` 要求它是最后一个片段。
- 已注册的槽位是十一个：lore、character、persona、summary、state、memory、history、scene、director、user_will、protocol。默认模板顺序：character、lore、state、summary、memory、scene、director、user_will、history、（可选的 block_format）、protocol。
- 原生块类型是 12 个（`thinking`、`选项`、`状态栏`、`变量更新`、`分析`、`图片`、`页眉`、`悄悄话`、`旁白`、`备忘`、`state_update`、`plot_note`）；`thinking`、`变量更新`、`state_update`、`plot_note` 的上下文策略是删除。
- 历史槽位默认策略：更早楼层省略五个显示类块，最近 1 楼不套用这层省略；`full` 是旧的完整视图。设置项 `historyBlockPolicy` 存在 `story_settings.history_block_policy`。
- 结算窗口以 head 为终点，取最旧的 N 个未结算助手楼层；冲突检查窗口取 head 路径最后 `conflictWindowFloors` 楼。现场分析以被分析的楼层为锚点，读取该楼层结算后的台账快照与路径上最近 6 楼原文。
- 回合模式的解析口只有 core 的 `resolveTurnMode`：单轮参数优先于故事设置，深回合直接抛出错误。server 在写楼层之前调用它，深回合返回 400。程序不在任何条件下自动切换模式（I6）。
- `extensions.dramaticer` 有三个键：`events`、`npcs`、`arcs`；`arcs` 的校验全部复用 `parseDirectorPlan`。
- 排障命令：`dramaticer explain --node <id> --db <path> [--json]`，只读、零模型调用。记忆检索段现在会显示每一路的父段信息与注入范围。
- 模型响应的磁盘缓存键包含 `max_tokens` 只在请求显式带 maxTokens 时；改渠道配置的 `maxTokens` 后必须换一个 `--cache` 目录。后台 `background` 模型的输出上限是 32,768。

## 评测与报告
- 自动试玩的 CLI 入口是 `pnpm --filter @dramaticer/st-compat playtest`；界面自动试玩是 `pnpm playtest`。`pnpm e2e` 会收集但跳过 `e2e/playtest/playtest.spec.ts`。
- 自动试玩续跑：live 默认 `PLAYTEST_RESUME=1`；续跑文件默认 `eval-private/reports/r5-playtest.progress.json`。跑满 60 轮才写最终报告。
- 会话外监督进程（R5-T14.a）：`scripts/r5-playtest-supervisor.mjs` 读 `.devloop/scratch/R5-T14/supervisor-config.json`；完成后停掉 server，不要重复启动。
- 统计版 `docs/dev/reports/R5-playtest.md` 是 60 成功 / 0 失败的最终版本；`docs/dev/reports/R5.md` 第一至三节与第七节已按最终数据库回填。
- F0 的私有产物：`eval-private/f0/`；R3 的产物：`docs/dev/reports/R3.md`、`R3-fast.md`；O 的产物：`docs/dev/reports/O-opening.md`；R2 的产物：`docs/dev/reports/R2.md`、`R2-judge.md`、`R2-pairwise.md`、`R2-b1.md`、`R2-forgetting.md`、`docs/dev/SCOREBOARD.md`；R4 的产物：`docs/dev/reports/R4.md`；R5 的产物：`docs/dev/reports/R5.md`、`R5-playtest.md`。
- 引用评测数字时：B1 必须同时说明同模型子集为空、每个对话每档只有 1 个样本；遗忘矛盾率必须同时说明失败题数与可判定样本数；选择一致率当前没有样本。
- 记分牌重新生成（仓库根目录执行）：`node packages/st-compat/dist/evalset/scoreboard-cli.js --playtest eval-private/reports/forgetting/playtest --playtest eval-private/reports/forgetting/legacy/playtest --forgetting eval-private/reports/forgetting/runs --forgetting eval-private/reports/forgetting/legacy/runs --b1-samples eval-private/reports/R2-b1/samples.jsonl --b1-records eval-private/reports/R2-b1/records.jsonl --b1-quality eval-private/reports/R2-b1/quality.jsonl --out docs/dev/SCOREBOARD.md`
- 遗忘评测（R2-T09.a）：`playtest --head` 只接受当前故事里存在的助手楼层，且不能与 `--resume` 同时使用；证据楼层不在当前路径上的题目记 `skipped`；遗忘分层固定为 `<100`、`100-199`、`200-299`、`300+`。
- R2-T09 的 legacy native 同题对照：100–199 楼矛盾率 66.7%（6/9），200–299 楼 100.0%（7/7），上升 33.3 个百分点；这是 R1-T03.a 默认开启的依据。

## 注意事项
- `.env` 已由人类填写，**不要覆盖**。
- 私有数据（`eval-private/`、`data/`、`.env`）不能进入测试数据、提交、文档或日志；报告只写统计数字，不写对话原文。
- `eval-private/raw/` 有 94 个文件；`eval-private/reference/` 有 5 部参照小说。
- 真实渠道实跑用 `--model main-fallback --judge-model judge`（`rp` 仍 503）。
- 整轮门禁在 Windows 上并行跑 100 多个测试文件时，单个测试耗时可以比单独运行高十几倍。数据库或文件系统测试必须显式设置超时；`afterEach` 删除临时目录用 `rmSync` 时带 `maxRetries` 与 `retryDelay`。
- `packages/core/test/` 与 `packages/st-compat/test/` 下的 `.tmp-*` 目录会被测试创建；它们在 gitignore 里，不要提交。
- `packages/st-compat` 与 `packages/server` 在测试里通过 `@dramaticer/core` 的 `dist` 解析 core；只跑这两个包的测试前先执行 `pnpm run typecheck`。
- 沙箱消息的浏览器约束：srcdoc 沙箱在不带 `allow-same-origin` 时 `event.origin` 是字符串 `"null"`，读 `document.cookie` 会直接抛出 `SecurityError`。
- 聊天页、分支页、台账页、导演页、设置页与渠道页的手工冒烟脚本在 `.devloop/scratch/R5-T08`、`R5-T09`、`R5-T10`；M6-T04 与 M6-T05 的冒烟在 `.devloop/scratch/M6-T04/smoke.mjs` 与 `.devloop/scratch/M6-T05/smoke.mjs`。
- e2e 的假渠道细节（R5-T12）：`serve.mjs` 用固定端口 4517，`playwright.config.ts` 的 baseURL 与 webServer 都读 `E2E_APP_PORT`；假渠道用随机端口并写进每次重建的 `channels.yaml`；数据库固定在 `.devloop/scratch/e2e/work/e2e.db`。
- Vertex 渠道（V-T01）：`api: google-vertex` 使用 pi-ai 1.5.0 的适配器；凭证、项目、区域只从 `.env` 的三个 `GOOGLE_*` 变量读取，服务账号 JSON 不进仓库。
- 生图（M6-T01 至 M6-T05）：`images.example.yaml` 是配置模板；`data/images.yaml` 缺失时 provider 列表为空、导入拒绝、illustrate 任务不注册。workflow 存在 `image_workflows`，同名导入更新同一行；视觉档案存在 `character_visual_profiles`；`node_images.file_name` 是相对路径，实际文件在 `mediaDir` 下；`readImageDimensions` 只支持 PNG、GIF、WebP、JPEG。
- 不要修改 `AGENTS.md`、`CLAUDE.md`、`scripts/check-invariants.mjs`、`tools/devloop/` 下的任何文件。不变量 I6 双模式只由玩家切换，I7 不做多 agent 并行讨论，I9 导演实时选择用纯程序，I11 间隙优先，I12 台账是唯一事实来源，I13 尊重模型能动性，I14 本地 ST 额度需申请，I15 core 不依赖任何其他工作区包。

## 下一步
- 选 R1-T03.b 重排序：新增 `RerankClient` 与 `reranker` 渠道段，融合后按 `rerankCandidates` 重排；默认关闭，用 R1-T04.b 的记忆评测决定是否开启。
- M6-T99 仍等待 HUMAN-15；人类把 ComfyUI 启动并放入 workflow JSON 后，把 TASKS 里 `[!]` 改回 `[ ]` 再做验收。
- R1 续后续：R1-T03.b（无迁移）、R1-T04.b、R1-T05（v36）、R1-T06（v37）、R1-T08（v38）、R1-T99.a。章节压缩任务写的是 v36，与当前 schema 35 顺延一致。
- C 线兼容插件任务依赖 P2；插件系统以 DESIGN §19 为唯一权威。
