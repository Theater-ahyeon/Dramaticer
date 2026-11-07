# 会话日志（只追加）

格式：`- <日期> | S<会话号> | <任务ID> | <结果状态> | <一句话>`

- 2026-11-06 | S0 | - | INIT | 人工写入设计文档与开发协议
- 2026-11-06 | S2 | M0-T01 | DONE | 补齐 st-compat 骨架并安装依赖，门禁通过；setvar 探针验证 I1 检查有效
- 2026-11-06 | S3 | M0-T02 | DONE | 快照脚本复制 67 个私有文件并生成 sha256 manifest，逐文件核对一致，门禁通过
- 2026-11-06 | S4 | M0-T03 | DONE | 实现聊天 jsonl 流式解析与 10 个测试；真实快照 1222 条消息解析通过，门禁通过
- 2026-11-06 | S5 | M0-T04 | DONE | 实现角色卡解析（PNG 的 ccv3/chara、V1/V2/V3 JSON）与 13 个测试；真实快照 3 张卡解析通过，门禁通过
- 2026-11-06 | S6 | M0-T05 | DONE | 实现世界书与预设解析（含 prompt_order、正则脚本、数字字符串额度）与 21 个测试；真实快照 3 个世界书、58 个预设解析并结构往返通过，门禁通过
- 2026-11-06 | S7 | M0-T06 | DONE | 实现 core 领域类型与 SQLite 存储（stories/nodes/state_diffs/FTS5 node_text，trigram 分词，user_version 迁移，节点原文不可修改）与 13 个测试，门禁通过
- 2026-11-06 | S8 | M0-T07 | DONE | 实现 ST 聊天导入：主路径与 swipe 兄弟节点、MVU 快照 diff；11 个测试，真实快照 1222 层累加往返零差异，门禁通过
- 2026-11-06 | S9 | M0-T08 | DONE | 实现体检报告 CLI 与统计版报告：对话字节/token、diff/快照 20.8%、重复度曲线、实体与 58 个预设的宏和正则统计；26 个新测试，门禁通过
- 2026-11-06 | S10 | M0-T09 | DONE | 实现正则分类器（8 类、删除范围、四种升级策略）与报告章节；928 条正则中启用 637 条、可升级 300 条（47.1%），18 个新测试，门禁通过
- 2026-11-06 | S11 | M0-T10 | DONE | 实现状态题生成器与 CLI（稳定区间、快照核对）；3 个对话共 236 题（71/65/100）全部核对一致；ADR-0006 把空对象快照视为没有更新，体检报告 diff/快照降到 20.8%；10 个新测试，门禁通过
- 2026-11-06 | S12 | M0-T11 | DONE | 实现 core OpenAI 兼容客户端（限速、重试、请求级缓存、思考 token）与事件题生成器/CLI；3 个对话各 50 题，结构核对全部一致，抽查 30 题；antigravity 账号被停用后用 auto/deepseek-v4.1-flash 完成第三个对话（HUMAN-05）；15 个新测试，门禁通过
- 2026-11-06 | S13 | M0-T12 | DONE | 实现固定窗口分块与 FTS5 trigram 块索引，按提问楼层之前检索并统计命中@5/10/20；386 题命中 126/143/153（事件题 113/128/137，状态题 13/15/16），报告写入私有版和统计版 health；16 个新测试，门禁通过
- 2026-11-06 | S14 | M0-T13 | DONE | 实现 ACU 对照组：单元格历史配逐楼层 hash_sheets、整表数据、内存 SQLite 重放 SQL 更新三种来源，按提问楼层之前最近的表格内容做规范化包含判断；386 题覆盖 91（状态题 88/236、事件题 3/150），按答案长度分档报告；7 个新测试，门禁通过
- 2026-11-06 | S15 | M0-REVIEW-1 | DONE | 完成代码与不变量审查：I1–I10 逐条判断，发现 32 条代码问题（ACU 拼接误报、导入非事务、检索按块计数等）、7 条文档不同步与测试覆盖缺口；转成 M0-FIX-1 到 M0-FIX-11，门禁脚本两处缺口写入 HUMAN-06；门禁通过（157 个测试）
- 2026-11-06 | S16 | M0-FIX-1 | DONE | 导入放进单事务（新增 StoryStore.runInTransaction），失败回滚故事/楼层/diff/FTS；swipe_id 越界或非整数在解析层抛错，节点 id 与快照下标一致；补嵌套空对象与状态题-store 回放用例，6 个新测试，门禁通过（163 个测试）
- 2026-11-06 | S17 | M0-FIX-2 | DONE | 聊天解析首行剥离 UTF-8 BOM（流式与文件两种入口都有用例）；`splitChatLines` 两处内联换行处理改用 `stripCarriageReturn`；角色卡改用 `field-readers.ts` 的读取函数并删除本地重复实现，PNG 载荷增加 base64 回环校验；`SourceLine`、`splitChatLines`、`isPngData`、`SnapshotDiffOp` 退出公开导出；PNG fixture 支持原样写入文本，补 tEXt 解码失败与非法 base64 两条用例；3 个新测试，门禁通过（166 个测试）
- 2026-11-06 | S18 | M0-FIX-3 | DONE | 后台 LLM 客户端：2xx 非 JSON 只请求一次，中止与超时等读取错误原样抛出；退避与限速等待接收中止信号，Retry-After 上限 60000ms；缓存键并入 apiKey 摘要，stableJson 与 JSON.stringify 语义一致；删除不可达的尾部抛出与 LlmResponseError 重试分支；13 个新测试，门禁通过（179 个测试）
- 2026-11-06 | S19 | M0-FIX-4 | DONE | `ChunkIndex` 写入与查询共用 `normalizeRetrievalText`（NFKC + 去标点/符号/空白），纯标点块不写入；检索评测按 `nodeId` 保序去重，越界 `askAtNode` 抛错并指出题目；补分块与索引边界测试，报告命中更新为 141/156/163（@5/@10/@20），门禁通过（188 个测试）
- 2026-11-06 | S20 | M0-FIX-5 | DONE | ACU 表格快照改为单元格值列表（单元格历史、整表内容、SQL 重放），逐值规范化后判断答案是否出现在某一个单元格里，相邻单元格不再拼接；提问楼层不在对话里抛错并带楼层与题目 id；补相邻单元格负例（`集市时间` 不命中、`集市` 命中）与缺楼层用例，报告 ACU 覆盖仍为 91/386，门禁通过（190 个测试）
- 2026-11-06 | S21 | M0-FIX-6 | DONE | `getStateDiffs` 对不存在的楼层抛错；`applyMigrations` 校验迁移版本号从 1 连续递增（支持注入列表）；`assertStateDiffPath` 在写入与读取两侧校验路径，读取错误带 diff id；删除零调用的 `getLatestSchemaVersion`；版本测试注册临时目录清理，删除 43 个历史 `.tmp-store-*` 且重跑不再新增；3 个新测试，门禁通过（193 个测试）
- 2026-11-07 | S22 | M0-FIX-7 | DONE | 体检报告合计增加 `headerBytes`（66,397,069 字节，与分类之和的差额是 1,222 个行分隔符），每对话字段统计改为全量、截断只在渲染层；删除 `extraSwipeCount` 与 `totals.rawBytes`；`ratio` 对 0/0 返回 `null` 并显示 `—`；manifest 再导出合并到 `health/manifest.js`；`health/cli.ts` 抽成可注入路径的 `runHealthCli`；7 个新测试（含第 11 名字段 fixture、ACU 段、两条抛错分支、私有标识反向断言、CLI 写出检查），门禁通过（200 个测试），两份报告重新生成
- 2026-11-07 | S23 | M0-FIX-8 | DONE | `hasRenderSibling` 跳过停用的兄弟脚本；`classifyCore` 删除不可达的兜底分支；`analyzeDuplication` 入口统一校验四个正整数参数并在错误里带参数名；token 估算补谚文五个区段；删除零调用的 `countMacros`，`REGEX_CATEGORY_ORDER` 取消导出；4 个新测试，两份报告重新生成（可升级 300/637 = 47.1%），门禁通过（202 个测试）
- 2026-11-07 | S24 | M0-FIX-9 | DONE | `readQuestionFile` 重复 id 抛错并带文件与行号；事件题解析阶段的缺字段条目逐条计入失败记录；抽样改为 id 哈希的确定性函数；`EventQuestionStats` 删除三个无读取方字段；state CLI 拆出题量区间与 `summary.json` 写出；`event-cli --story` 只写故事专属抽查与汇总文件；`.env` 缺失错误带路径；evalset 内计分与 `requireNonEmpty` 合并到 `shared.ts`；19 个新测试，门禁通过（221 个测试）
- 2026-11-07 | S25 | M0-FIX-10 | DONE | `health/manifest.ts` 新增 `openSnapshot` 作为读取 raw 的唯一入口：manifest 条目必须带 `size` 与 `sha256`，`resolveFile` 校验路径不越界、`stat` 大小一致、流式 sha256 一致，错误都带 `target`；`collectHealthReport`、`collectRetrievalBaseline`、`collectAcuBaseline`、`runStateQuestionsCli`、`evalset/event-cli.ts` 全部改走该入口，`report.ts` 的本地路径与角色过滤辅助删除；fixture manifest 补齐校验字段；4 个新测试，门禁通过（225 个测试），真实快照 67 个文件校验通过
- 2026-11-07 | S26 | M0-FIX-11 | DONE | 两个 PNG 库声明为 st-compat 运行时依赖，DEPENDENCIES 增加声明位置列与工作区豁免；JSON 类型与 `isJsonObject` 合并到 core，删除 st-compat 的 `json.ts`；删除零消费者的 `MemoryEvent`；DESIGN §5 的 `state_diffs` 示例改用 `path`；ADR-0003 更新依赖位置；TASKS 与 LOG 的测试计数改为 11/10、diff/快照改为 20.8%；门禁通过（225 个测试）
- 2026-11-07 | S27 | M0-T99 | MILESTONE_DONE | M0 验收：全部报告重跑；1222 楼导入为 1279 个节点、2423 条 diff，回放 0 处差异；`docs/dev/reports/M0.md` 记录实测结论与 I1–I10；ADR-0008 校准 §2、§14 的存储与分层召回目标，并给 M1-T01、M1-T02 补安装与客户端迁移范围；门禁通过（225 个测试）
- 2026-11-07 | S28 | M1-T01 | DONE | 安装并锁定 `@earendil-works/pi-ai` 与 `pi-agent-core` 1.5.0；`spikes/pi/` 在真实渠道验证流式（96 个思考增量、24 个正文增量）、思考内容、函数调用、abort 后保留 21 字符部分正文并续写 2569 字符、三个钩子；Gemini 自定义 baseUrl 的请求地址确认为 `/models/<id>:streamGenerateContent`，gcli2api 未运行所以端到端跳过；ADR-0009 记录采用范围与渠道行为差异；门禁通过（225 个测试）
- 2026-11-07 | S29 | M1-T02 | DONE | 新增 `packages/core/src/llm`：薄接口（流式事件、用量、中止、截断、续写）、`data/channels.yaml` 多渠道优先级与 `${ENV}` 引用、pi-ai 适配器、按渠道限速与重试、失败切换、截断检测与自动续写、与 M0 一致的缓存键；删除旧 `client.ts` 与 522 行测试，事件题迁移到新接口，`loadDotEnv` 移到 core 并改为覆盖同名环境变量；模拟渠道 13 个路由测试、渠道配置 9 个、截断 8 个、缓存 4 个、env 2 个；真实渠道验证流式（首增量 1.57 秒）、中止后 23 字符正文续写为 2187 字符、`length` 续写两轮；门禁通过（241 个测试）
