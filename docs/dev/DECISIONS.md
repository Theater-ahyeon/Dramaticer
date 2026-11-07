# 决策记录（ADR）

格式：编号、日期、背景、选项、决定、影响。只追加新条目；被推翻的旧决策标记为"已被 ADR-xxxx 取代"，不要删除。

`docs/DESIGN.md` 附录 A 里的 Q1–Q28 是设计阶段的决策，这里不重复记录。

---

## ADR-0001 开发工具链（2026-11-06）
- **背景**：项目由 DeepSeek 驱动的 agent 自主开发，需要能无人值守地循环运行。
- **决定**：
  - 主 agent 用 oh-my-pi（`omp -p --auto-approve --max-time`），默认使用 omp 自己配置的 DeepSeek 模型；DeepSeek Harness 的 headless 模式作为备用。由 `tools/devloop/devloop.ps1` 驱动，每个会话做一个任务，会话之间通过仓库文件交接。
  - 测试用 vitest；lint 和格式化用 biome；数据库用 better-sqlite3。
- **影响**：如果 better-sqlite3 在 Windows 加 Node 24 上装不上，允许改用 `node:sqlite`，但要新写一条 ADR 记录下来。

## ADR-0002 自主开发流程细化与边界规则（2026-11-06）
- **背景**：INBOX 追加自主开发时的流程规范、阻塞处理、定期审查、异常恢复与发布边界指导。
- **决定**：
  - **开发流程**：执行任务前在 `HANDOFF.md` 记录执行计划，接着编写测试用例，再推进代码实现；对照 `AGENTS.md` 的不变量逐项核对变更，执行门禁命令验证并提交代码。
  - **阻塞降级**：遭遇依赖项未就绪时，优先提供离线或无外部服务的替代方案，将相关事项调整为不阻塞状态。
  - **定期审查**：累计推进 8 项任务后安排代码和设计不变量审查任务。
  - **多次停滞处理**：单个任务连续 3 次未完全完成时细分为子任务；细分后仍无法推进则记录替代方案并跳过。
  - **外部操作边界**：禁止自动执行代码仓库推送或公开发布等外部行为，所有物料准备完毕即达到结束条件。
- **影响**：后续任务严格遵循此流程；清空当前 INBOX 对应条目。

## ADR-0003 PNG 文本块解析依赖（2026-11-06）
- **背景**：快照脚本需要从角色卡 PNG 的 `tEXt` 块中取出 base64 编码的卡片 JSON，以确定角色引用的世界书；后续 M0-T04 也要解析 PNG 卡片。手写 PNG 字节解析既容易出错，也违反“成熟文件格式必须用库解析”的工程规则。
- **选项**：使用 `png-chunks-extract` 加 `png-chunk-text`；使用 `pngjs`；手写解析。
- **决定**：使用 `png-chunks-extract` 读取 PNG 块，使用 `png-chunk-text` 解码 `tEXt` 文本块。base64 与 JSON 解码用 Node 内置能力。
- **影响**：新增两个轻量开发依赖；M0-T04 可以直接复用这对库，避免再引入第二个 PNG 解析方案。M0-FIX-11 之后同两个库也是 `packages/st-compat` 的运行时依赖，根目录的副本只供快照脚本使用。

## ADR-0004 楼层全文索引使用 FTS5 trigram（2026-11-06）
- **背景**：`node_text` 需要支持中文原文检索。FTS5 默认的 `unicode61` 把连续的中日韩字符当成一个词，没有空格的整句无法被分词，检索基本不可用。
- **选项**：`unicode61` 加应用层预分词；`trigram`；不建 FTS5，改用 LIKE。
- **决定**：`node_text` 使用 `tokenize = 'trigram'`，由 `nodes` 表上的插入/删除触发器同步。查询按 FTS5 字符串字面量转义后做短语匹配；因为 trigram 需要至少 3 个字符，`searchNodeText` 对更短的查询直接抛错，不做模糊降级。
- **影响**：SQLite 需要 3.34 以上（当前 3.53.4）。M0-T12 的 BM25 基线可以直接使用这张表；如果检索质量不足，在新增迁移里替换分词方案，不改调用方接口。

## ADR-0005 导入时的 MVU 快照 diff 语义（2026-11-06）
- **背景**：M0-T07 要把 ST 聊天的相邻楼层 MVU 变量（整份 JSON 快照）转换成原生 `StateDiff`。`StateDiff.path` 要求非空，根值无法直接表达；数组删除元素后留下的空洞也无法用路径表达。
- **决定**：
  - 快照根必须是 JSON 对象或 `null`。`null` 表示这一层没有 MVU 更新，沿路径累加时保持上一层的状态。
  - 对象逐键递归，缺失的键生成 `op:"delete"`；新出现的对象递归到叶子，空对象生成一条 `op:"set"` 写入 `{}`。
  - 数组作为整体比较，变化时在数组所在的路径生成一条 `op:"set"`，不做下标级 diff。
  - 第一份快照相对 `{}` 生成 diff，因此从空对象开始累加就能还原。
- **影响**：按路径读出的 diff 可以精确还原每一层的对象快照；数组变化会多写一些字节，换取没有空洞、可以安全重放。根为数组或标量的聊天会在导入时直接报错。

## ADR-0006 空对象 MVU 快照表示没有更新（2026-11-06）
- **背景**：真实快照里，没有变量更新的楼层把 `variables` 写成 `[{}]`，解析后得到空对象 `{}`；带更新的楼层才写完整的 `{"stat_data": {...}, "schema": ...}`。ADR-0005 只把 `null` 当成没有更新，导入器于是把每个空对象都当成“清空全部变量”，在用户楼层制造大量 delete，下一次 AI 楼层再全部写回。按路径读出的中间楼层状态因此与原文快照不一致，状态类题目也无法基于这套 diff 生成。
- **决定**：`readSnapshot` 把空对象与 `null` 一样视为“这一层没有 MVU 更新”。真正清空全部变量时，MVU 写的是嵌套空对象（例如 `{"stat_data":{}}`），仍然会正常生成删除 diff。
- **影响**：导入后用户楼层继承上一条 AI 楼层的状态，diff 数量明显减少；依赖 diff 的状态题生成器按同一语义计算快照。`[{}]` 与 `null` 在解析结果里都表现为 `null`。


## ADR-0007 后台 LLM 客户端与事件题出题方式（2026-11-06）
- **背景**：M0-T11 需要用后台模型为评测集生成事件类题目。M0 阶段只需要一次性的批处理调用，M1 会换成 pi-ai 的完整模型层，因此客户端必须保持很薄，同时保证评测集可重复生成、不重复计费。
- **决定**：
  - `packages/core/src/llm/client.ts` 实现 OpenAI 兼容的 Chat Completions 客户端：非流式、按每分钟请求数串行限速、对 429/5xx/超时与网络错误按指数退避重试（Retry-After 参与退避并设 60 秒上限，等待期间响应调用方中止）、按请求内容的 sha256 做文件缓存。缓存键包含 `baseUrl` 与 api key 的 sha256 摘要（不写原文）；2xx 响应体不是合法 JSON 时只请求一次，直接抛出 `LlmResponseError`。缓存目录由调用方指定，缓存内容不含 api key。
  - 事件题以“窗口”为单位生成：把非 system 楼层按字符预算切成连续窗口，沿故事均匀取样最多 24 个；窗口最后一楼固定为提问楼层，证据楼层必须落在窗口内且比提问楼层至少早 2 楼。模型返回的题目逐条校验，重复题目按去掉标点后的文本去重，最后按窗口轮转选出 50 道，避免集中在故事开头。
  - 事件题的答案无法用规则判定，自动核对只检查楼层存在性、先后顺序和字段完整性；答案质量由 `eval-private/evalset/spotcheck.md` 的 20% 人工抽查（HUMAN-03，可选）负责。
- **影响**：不新增依赖，客户端在 M1 被替换时只需保留 `LlmClient` 接口。重新运行 `pnpm --filter @dramaticer/st-compat evalset:events` 会命中缓存，不会重复调用渠道；删除 `eval-private/llm-cache` 可以强制重新生成。

## ADR-0008 M0 实测对设计假设的校准（2026-11-07）

- **背景**：M0-T99 用 3 个私有对话、3 张卡、3 本世界书、58 个预设跑完全部报告，并重新验证了 1222 个楼层的导入回放。实测数字与 `DESIGN.md` §2 的诊断、§14 的目标有多处不一致。
- **实测**：
  - 单楼文件体积分别为 36.2 KB、24.3 KB、153.4 KB，平均 54.3 KB；§2 写的“每楼 60–150 KB”只对最大的对话成立。
  - “整份状态快照”的主要来源是 ACU 表格：`hash_sheets` 14.38 MB、对话头部 25.78 MB（其中大部分是 `chat_metadata` 的表格历史）；MVU 变量合计只有 1.33 MB。原生 diff 与快照的体积比是 20.8%。
  - 原生存储估算：全部楼层原文 8.85 MB，加思考内容 1.08 MB、状态 diff 0.26 MB，合计 10.19 MB；三个对话分别是 ST 文件的 5.5、3.6、10.0 倍，平均 6.5 倍。单楼约 8.3 KB。原文在 I4 下不可压缩，因此“降低一个数量级以上”对这组数据不成立。
  - 预设实测 8004 个条目（启用 2361）、485 个 marker、`setvar` 4911 次、`getvar` 3584 次、`addvar` 522 次；§2 写的“200+ 条目，数百次 setvar/getvar”低了一个数量级。
  - 正则分类：渲染 UI 355 条（38.3%，其中内联脚本 141 条）、删除内容 319 条（34.4%）、删除思考链 76 条（8.2%）；启用的 637 条里 300 条可自动升级（47.1%）。
  - ACU 与 BM25 互补：状态题 ACU 37.3%、BM25 8.1%；事件题 ACU 2.0%、BM25 96.0% @20（83.3% @5）。
  - 4-gram Jaccard 只在 1 个对话里检出持续上升（第 82 楼），另两个没有；平均相似度 0.108–0.119。
- **决定**：
  - 更新 `DESIGN.md` §2 的数据行，改为实测值，并把“状态快照重复”指向 ACU 表格与插件字段。
  - 更新 `DESIGN.md` §14：存储目标改为“合计平均单楼原文加 diff 不超过 10 KB”（实测估算 8.3 KB）；正则自动升级率写入实测值 47.1%；记忆召回按题型分层，状态题对照 ACU 37.3%，事件题对照 BM25 83.3% @5；预设可用率在 C 线开始前用导入清单实测后再定目标。
  - M2 的过关标准改为按题型分层；M3 的重复检测必须用 embedding 节拍与场景类型序列，字符 n-gram 只保留为离线基线。
  - M1-T01 先用 pnpm 安装并登记 `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core`；M1-T02 把事件题生成器迁移到新的 `core/llm` 接口后再删除 M0 的最小客户端。
- **影响**：不改“不做”清单，也不改里程碑顺序。§14 的存储目标从倍数改为单楼字节上限，验收时以 `docs/dev/reports/M0.md` 的实测口径为准。

## ADR-0009 采用 pi-ai 与 pi-agent-core（2026-11-07）

- **背景**：DESIGN §10 把 pi-ai 与 pi-agent-core 定为模型层，附录 A 标注“M1 验证后才最终确定”。M1-T01 需要在真实渠道上验证流式、思考内容、函数调用、abort 后续写，以及 agent-core 的三个钩子；验证脚本放在 `spikes/pi/`，Node 24.13.0，两个包都锁定为 `1.5.0`（根目录 devDependencies，M1-T02 采用后再移到 `packages/core` 的运行时依赖）。
- **验证环境**：`.env` 的正文渠道 `DRAMATICER_MAIN_BASE_URL=http://127.0.0.1:3425/v1`，模型 `opendesign/deepseek-v4.1-flash`。用 `createProvider` 加 `openAICompletionsApi` 包装成单模型 provider，模型 id 原样透传（带斜杠的前缀不被解析）。
- **结果**：
  - **① openai-completions 流式、思考、函数调用：通过。** 同一请求收到 96 个 `thinking_delta`、24 个 `text_delta`；第一个事件在 1.65 秒到达，第一个正文增量在 3.54 秒，说明是增量流式；思考 348 字符、正文 87 字符，`stopReason` 为 `stop`；用量 input 43、output 303、reasoning 241。强制 `toolChoice` 后返回 `get_time` 调用，参数 `{"timezone":"Asia/Shanghai"}`，`stopReason` 为 `toolUse`，内容块为 `thinking` 加 `toolCall`。
  - **② Gemini 原生自定义 baseUrl：部分通过，端到端跳过。** Google 适配器拒绝注入的 `fetch`（错误信息为 “Custom fetch is not supported by the Google Generative AI adapter”），因此渠道体检不能靠替换 fetch 抓请求。通过临时观察全局 `fetch` 确认请求地址是 `http://127.0.0.1:7861/models/gemini-2.5-flash:streamGenerateContent?alt=sse`，即 `model.baseUrl` 原样作为 Gemini API 的根路径。gcli2api 没有运行（端口 7861 连接被拒绝），所以没有验证它的响应是否兼容；HUMAN-04 保持待处理。
  - **③ abort 后续写：通过。** 在收到 4 个正文增量后中止，`stopReason` 为 `aborted`，保留 21 个字符的部分正文（内容块含 `thinking` 与 `text`）；把部分消息放回上下文并追加“接着写”的用户消息后，续写 `stopReason` 为 `stop`、正文 2569 字符。中止后的 `usage` 全是 0，不能用于计费统计。
  - **④ agent-core 三个钩子：通过。** `prepareRequest` 替换后的上下文真正进入请求（模型回复了注入的随机串，而不是原来的 prompt）；`beforeToolCall` 收到已经校验的参数 `{"text":"hello"}`，返回 `block` 后产生错误工具结果；`finishTurn` 在工具结果之后调用一次并返回 `{action:"end"}`，阻止了第二次请求（`onPayload` 只触发 1 次，`turn_end` 与 `agent_end` 各 1 次）。
- **发现的行为**：
  - 该渠道在 `reasoning:"off"` 时仍然输出思考内容并消耗输出 token；能否关闭思考取决于渠道，pi 只负责发参数。
  - 中止时 `usage` 为全 0；需要计费或统计时以最后一次完整响应为准。
  - gcli2api 必须把 Gemini API 的路径（`/models/<id>:streamGenerateContent`）挂在 baseUrl 根下。
  - pnpm 忽略了 `@google/genai` 与 `protobufjs` 的构建脚本；OpenAI 兼容适配器不受影响，Gemini 适配器在 gcli2api 可用时需要重新验证。
- **决定**：
  - 采用 pi-ai 作为模型层：OpenAI 兼容 Chat Completions 优先，Gemini 原生第二；`core/llm` 只包一层薄接口（流式事件、用量、中止、切换、重试、截断续写），不把 pi 的类型泄漏到领域层。
  - 采用 pi-agent-core，但只当作无状态单轮执行器：`prepareRequest` 注入组装好的上下文，`beforeToolCall` 做校验与拦截，`finishTurn` 用 `{action:"end"}` 把每轮请求数限制在 1 次；`identity` 设为 `{ attribution: null }`。
  - 渠道配置保存 `baseUrl`、模型 id 字符串和 api key 的环境变量名；模型 id 不解析前缀。
- **影响**：M1-T02 按此实现；渠道体检（M1-T03）不能依赖注入 fetch，需要从 `onPayload`、错误信息或服务端日志取请求地址；Gemini 端到端验收继续受 HUMAN-04 影响。

## ADR-0010 core/llm 的渠道、重试与续写（2026-11-07）

- **背景**：M1-T02 要把 M0 的最小后台客户端换成正式的 `core/llm` 接口，同时保留已有评测缓存，避免重复调用渠道。设计要求多渠道按优先级切换、重试、截断检测与续写，但不希望 pi 的类型进入领域层。
- **决定**：
  - `core/llm` 暴露 `LlmClient.complete` 与 `LlmStreamingClient.stream`：流式事件只有 `text_delta` 和 `thinking_delta`，最终结果包含结束原因、用量、渠道 id、尝试次数、轮数与截断原因；中止通过 `AbortSignal`。
  - 渠道配置放在 `data/channels.yaml`（被 git 忽略），仓库根目录提交 `channels.example.yaml`。所有字符串支持 `${VAR}`，从 `.env` 读取；`apiKey` 必须写成环境变量引用，不能写字面量。一个模型按顺序列出渠道，顺序就是优先级。
  - 用 pi-ai 的 API 实现直接调用 `streamSimple`，按 `openai-completions` / `google-generative-ai` 分支；pi-agent-core 留到接入工具与单轮执行器时使用。pi 的 `AssistantMessage`、`Usage` 等类型只在适配器内部出现。
  - 路由层负责限速、重试与切换：可重试错误（429、5xx、408/409/425、超时与网络错误）先在当前渠道按指数退避重试；没有内容时重试耗尽后切换渠道；已经输出内容后发生错误时，把已有正文作为续写上下文切换渠道。
  - 截断检测：`stopReason === "length"` 一定判为截断；配置 `expectedTags` 时检查未闭合标签与被切断在标签中间的情况；`detectAbruptEnd` 显式开启后才按句尾字符判断突然中断。默认只对 `length` 自动续写，最多 1 轮。
  - 缓存键与 M0 客户端完全一致（渠道 baseUrl、apiKey 摘要、模型 id 与请求体），读取时按渠道优先级逐个尝试，写入时用实际成功的渠道，因此 `eval-private/llm-cache` 里的旧结果仍可命中。
  - `loadDotEnv` 改为用 `node:util` 的 `parseEnv` 读文件并覆盖 `process.env` 的同名变量：项目的 `.env` 是渠道配置的唯一来源，避免外部环境残留变量改变模型或密钥。
- **影响**：事件题生成器改用 `data/channels.yaml` 的 `background` 模型并继续使用原缓存；旧的 `OpenAiCompatibleClient` 删除。后续 M1-T03 的渠道体检、M1-T06 的工具调用和 M1-T07 的单轮 CLI 都通过这个接口接入。

## ADR-0011 渠道体检的实现与结果存放（2026-11-07）

- **背景**：M1-T03 要在真实渠道上判断哪些能力可用，供结构化输出在函数调用与文本标签之间选择。渠道适配器对函数调用没有接口，旧的后台客户端也不能复用；体检结果需要一个稳定位置，后续任务直接读取，不用每次重新探测。
- **决定**：
  - `packages/core/src/llm/probe.ts` 的 `probeChannel` 直接对单个 `LlmChannel` 发请求，不走 `LlmRouter`、不走缓存，避免多渠道切换和缓存命中掩盖真实能力。四组请求分别是流式、函数调用、预填充、缓存统计。
  - 流式：同一次请求同时判断思考与用量。正文增量不少于 2 个判为 `streaming`；只有 1 个或正文只在结束时出现判为 `buffered`；请求失败或没有正文判为 `unknown`。思考内容非空判为支持；输入与输出 token 都非空判为用量支持。
  - 函数调用：带一个 `dramaticer_probe` 工具并明确要求调用；返回同名工具调用判为支持；返回成功但没有工具调用判为不支持；错误信息提到工具不受支持时判为不支持，其余错误判为未知。
  - 预填充：消息末尾放一条助手消息 `{`，要求续写 JSON；返回内容能被 `{` 补齐并解析出预期字段判为支持，返回以 `{` 开头的完整对象判为不支持，其余判为未知。
  - 缓存统计：用同一个较长的 system 前缀连续发两次请求；第二次的 `cachedTokens` 大于 0 判为支持，两次都为 0 判为不支持。
  - `LlmRequest` 与 `LlmProviderRequest` 增加可选 `tools`，`LlmResult` 与 `LlmProviderResult` 增加 `toolCalls`。pi 适配器负责映射工具定义、提取工具调用；路由层透传，缓存键只在带工具时把工具定义并入请求体，原有缓存键不变。
  - 结果写到 `models.<alias>.probe`：`probedAt`、`channel`、`modelId`、`streaming`、`functionCalling`、`thinking`、`prefill`、`usage`、`cacheStats`、`structuredOutput`、`notes`。写入用 YAML Document，保留注释与 `${ENV}` 引用原文。
  - CLI：`dramaticer probe <channel> [--model <alias>]`。渠道被多个模型使用时必须指定模型，避免把某个模型的能力写到另一个模型上。
- **实测（`main` 渠道，`opendesign/deepseek-v4.1-flash`）**：流式、函数调用、思考、用量、缓存统计均支持；预填充不支持，模型忽略末尾的助手消息并重新输出完整 JSON。第二次相同的大前缀请求命中缓存 5248 个 token。流式请求收到 7 个正文增量，首个增量 2093 毫秒，2173 毫秒完成。
- **影响**：M1-T06 直接读取 `models.<alias>.probe.structuredOutput` 选择传输方式。探测本身不重试也不限速，渠道繁忙时可能把单项记为未知；重新运行 `pnpm dramaticer probe <channel> --model <alias>` 即可刷新结果。`data/channels.yaml` 被 git 忽略，体检结果不会提交。

## ADR-0012 上下文组装器的数据模型（2026-11-07）

- **背景**：DESIGN §9 要求原生模板由有序段落组成，段落可以是静态文本、条件段或 harness 槽位；还要按优先级裁剪 token 预算，并在 Trace 里记录每一段的来源和 token 数。槽位内容的角色（system / user / assistant）和顺序必须能直接交给 `LlmRequest`。
- **决定**：
  - `packages/core/src/context/template.ts` 定义模板数据：`ContextTemplate` 是片段数组；片段只有 `static`（静态文本）与 `slot`（槽位名取自 DESIGN §9 的九个槽位）两种。条件段用片段上的 `when` 表达，不对静态段和槽位分别造条件包装类型。
  - 条件本身也是数据：`switch`（开关，未设置按 false）、`state`（按路径 `exists` / `equals` / `truthy`），以及 `all` / `any` / `not` 组合。条件在调用槽位提供者之前求值，条件为假的槽位不会被取内容。
  - 槽位提供者返回 `ContextMessage[]`（`role` 加 `content`）和一句来源描述，而不是纯文本：历史槽位需要按 user / assistant 交替输出，其余槽位输出 system 消息。没有提供者、返回 `null` 或返回空消息都记为 `missing-slot`，不抛错；提供者返回的消息结构不合法则直接抛错。
  - 预算裁剪按片段的 `priority` 从高到低选择，同优先级保留模板里靠前的片段；片段整体保留或整体丢弃，不做片段内部截断。选中之后按模板顺序输出，保证上下文前缀稳定。Trace 按模板顺序列出每个片段的状态（`included`、`condition-false`、`missing-slot`、`budget-dropped`）、来源与 token 数，并给出总 token 数。
  - `createTokenEstimator` 从 `packages/st-compat/src/health/token-estimate.ts` 移到 `packages/core/src/tokens.ts`，st-compat 的体检报告改为从 core 引用，避免两套估算函数。
- **影响**：M1-T07 把 `AssembledContext.messages` 直接放进 `LlmRequest`，把 `trace` 写进楼层节点。片段内部截断与槽位自己的 top-K 控制留给 M2 的提供者实现；本任务只保证整体预算与可观测性。

## ADR-0013 增量块解析器的语义（2026-11-07）

- **背景**：DESIGN §6 要求把模型输出里的标签块解析成显示、上下文、记忆三种视图，并且必须支持流式输出。流式输入会在任意位置切断标签，解析器需要明确未闭合块、嵌套、非法标签与段首未知文本的处理方式，才能保证逐段推入与一次性解析得到相同结果。
- **决定**：
  - 标签是注册表里的完整字符串 `<name>` 与 `</name>`，不支持属性；未注册的标签、没有对应开启标签的闭合标签、以及不是当前块自己的闭合标签都保留为普通文本，避免错误吞掉正文。
  - 解析结果是有序树：文本节点与块节点交替出现。`ParsedBlock.raw` 是块内原文（不含自己的标签），`complete` 为 false 表示输入结束时仍未闭合；嵌套块按出现顺序放在父块的 `content` 里。
  - 推入内容只有在末尾恰好构成某个标签的前缀时才缓冲；`snapshot()` 不包含这段未确定的前缀，`finish()` 把它当作普通文本。结束后再推入直接抛错。
  - 块类型在 `createBlockTypeRegistry` 登记，重名、非法名称与非法策略在创建时抛错。三类策略用数据联合类型声明：显示为 `native` / `html` / `hidden`，上下文为 `keep` / `drop` / `keep-depth` / `compress`，语义为 `none` 或接收已闭合块、返回状态变更或剧情笔记的 `handler`。
  - 默认注册表包含 DESIGN §6 的原生协议块：`thinking`（隐藏、不进入上下文）、`选项`、`页眉`、`悄悄话`、`旁白`、`备忘`；ADR-0014 增补了 `state_update` 与 `plot_note`。
- **影响**：M1-T06 的文本标签模式直接读取 `complete` 的块并交给同一个校验器；M1-T07 按显示与上下文策略生成视图。语义处理器在接入状态与剧情笔记时实现，解析器本身不修改原文。

## ADR-0014 结构化输出的负载与两种传输方式（2026-11-07）

- **背景**：DESIGN §11 要求 `state_update` 与 `plot_note` 既能通过函数调用输出，也能通过文本标签输出，并且共用同一套校验。模型输出不可信，非法值必须被拒绝并留下原因；文本标签又必须与显示层共用同一个块解析器，否则未闭合块会被当成正常内容。
- **决定**：
  - 负载模型在 `packages/core/src/structured`。`state_update` 是单个状态变更：`path`（非空字符串数组，元素去掉两端空白）、`op`（`set` / `delete`）、`value`（`set` 时必须有，可以是 `null`；`delete` 时不能出现）、`reason`（可选字符串，空串归一化为 `null`）。`plot_note` 只有非空的 `text`。两者都拒绝未知字段，路径拒绝 `__proto__`、`constructor`、`prototype`，避免将来应用 diff 时污染原型链。
  - 一次调用或一个标签只承载一条变更，多条变更就是多次工具调用或多个标签。这样某一条非法时其余条目仍然有效，拒绝粒度与记录原因一一对应。
  - 函数调用模式直接读取 `LlmResult.toolCalls`，只认两个写入类工具，其他工具（将来的读取类工具）忽略。文本标签模式用 `BlockParser` 解析完整回复，只取 `complete` 的块；未闭合、空内容、非法 JSON 都记为一次拒绝并保留原文。
  - 拒绝结果是数据而不是异常：`StructuredOutputCollection` 同时返回通过校验的 `stateUpdates`、`notes` 和被拒绝的 `issues`（负载、原文、原因）。调用方把 `issues` 写进 Trace，不中断生成。
  - `state_update` 与 `plot_note` 登记进 `DEFAULT_BLOCK_TYPES`，显示策略为 `hidden`、上下文策略为 `drop`、语义策略为 `none`：显示层与上下文层自动忽略这两个标签，语义写入由收集器显式完成，解析器不修改原文。
  - JSON Schema（`STATE_UPDATE_SCHEMA`、`PLOT_NOTE_SCHEMA`）与 `STRUCTURED_OUTPUT_TOOLS` 供函数调用模式使用；schema 只是给模型的说明，校验器才是权威，两者表达同一套约束。模式由 `resolveStructuredOutputMode(probe)` 决定：有体检结果用 `probe.structuredOutput`，否则回退到文本标签（不依赖渠道的工具能力）。
- **影响**：M1-T07 按模式选择工具定义或提示词，把 `issues` 写进 Trace，把 `stateUpdates` 与 `notes` 写进楼层节点。`illustrate` 与其他读取类工具不在本模块范围内。

## ADR-0015 单轮生成链路与 Trace 存储（2026-11-07）

- **背景**：M1-T07 要求 `dramaticer chat --story <id>` 把导入的角色卡、默认原生模板、流式生成、块解析、结构化输出和楼层落库串起来，并留下完整 Trace。CLI 需要 st-compat 解析角色卡，而 core 不能依赖 st-compat（I1）；存储层此前只有楼层、状态 diff 与全文索引，没有 Trace 的位置。
- **决定**：
  - 生成链路放在 core 的 `chat` 模块。`createDefaultContextTemplate` 生成 DESIGN §9 的默认模板：character、lore、state、summary、memory、director、protocol、history 八段，protocol 段按结构化输出模式给出标签写法或工具说明，history 的裁剪优先级最高。
  - `createHistorySlotProvider` 沿路径取最近 20 楼，用块上下文策略渲染：`drop` 删除、`keep` 保留块与标签、`keep-depth` 按距离尾部的深度裁剪；`compress` 尚未实现，遇到时直接抛错。`createStateSlotProvider` 回放路径上的状态 diff 渲染当前状态；`applyStateDiffs` 放在 core 顶层，用 defineProperty 写自身属性，避免 `__proto__` 路径段修改原型链，删除不存在的路径视为没有变化。
  - `runChatTurn` 追加用户楼层、组装上下文、把正文增量推给 `BlockParser`、按模式收集结构化输出，然后在一个事务里写入助手楼层、状态 diff 与 Trace。流式增量拼接后的正文与 `LlmResult.text` 不一致时抛错，不写助手楼层，避免保存无法复现的原文。
  - Trace 存在独立的 `traces` 表（schema 版本 2），以楼层 id 为主键，保存模板 id、上下文逐段状态与 token 数、实际模型与渠道、用量、截断与续写、结构化输出的接受与拒绝明细、首字与总耗时。一个楼层只写一次 Trace；楼层原文仍然不可修改。
  - CLI 入口放在 st-compat（`packages/st-compat/src/cli.ts`），分发 `probe`（调用 core 的 `runProbeCli`）与 `chat`：`chat --story <id> --card <path> --user <text> [--db <path>] [--model <alias>] [--budget <tokens>] [--max-tokens <n>] [--temperature <x>]`。故事不存在时按卡名建立故事并把 `first_mes` 写成开场楼层；每次运行都用角色卡字段重建角色槽位，因此同一故事始终带同一张卡。模型别名默认取 `main`，配置里没有 `main` 时要求 `--model`。
  - 结构化输出模式来自渠道体检（`resolveStructuredOutputMode(model.probe)`）：函数调用模式把 `STRUCTURED_OUTPUT_TOOLS` 放进请求，文本标签模式在 protocol 段说明标签写法。
- **影响**：M1-T99 的首字延迟直接读 Trace 的 `timing.firstTokenMs`。M2 的状态快照缓存替换 `createStateSlotProvider` 里的即时回放即可，接口不变。显示视图与压缩策略仍未实现。

## ADR-0016 后台任务的队列与重试语义（2026-11-07）

- **背景**：M2-T03 要建立后台任务的公共前提：事件抽取、摘要与向量索引都按楼层、按类型各执行一次。任务必须能跨进程暂停与恢复，不能挂在一个长期运行的循环里；chat 轮次不能因为后台工作增加模型调用。
- **决定**：
  - schema 版本 5 新增 `background_jobs(id, story_id, node_id, kind, status, attempts, last_error, created_at, started_at, finished_at)`，`UNIQUE(node_id, kind)` 保证同一楼层的同一类型只有一行；`status` 只取 `pending`、`running`、`done`、`failed`。触发器拒绝 `story_id` 与楼层所属故事不一致的行。
  - “已确认楼层”沿用 M2-T01 的定义：存在子节点。`enqueueMissingJobs` 只扫描这些楼层，按楼层创建顺序、再按类型顺序插入；`ON CONFLICT DO NOTHING` 让重复调用不产生新行。入队只针对本轮请求的类型，drain 不带类型过滤时取注册表里的全部类型。
  - 任务类型注册表是 `kind → handler` 的只读映射，处理器收到 `{store, client, job}`。drain 只执行注册表里的类型；请求或队列里出现未注册的类型直接抛错，避免静默跳过任务。
  - `attempts` 在每次开始执行前加一。一次 drain 里每个候选任务最多执行一次；失败时记录 `last_error` 并退回 `pending`，`attempts` 达到 3（首次执行加两次重试）仍未成功时标为 `failed` 并写入 `finished_at`。成功时清空 `last_error`。进程在执行中退出留下的 `running` 行不会自动重置，下一轮只处理 `pending`，避免重复执行。
  - drain 先补齐任务，再按 `created_at`、`id` 顺序取 `pending` 行，`limit` 默认为 20，只作用于本轮；任务按故事分别执行，`drainBackgroundJobs` 的接口保持 `{storyId, client, kinds, limit, now}`。时间戳统一由注入的 `now` 生成，测试可以固定。
  - `dramaticer work --db <path> [--limit <n>] [--kind <kind>]` 只执行一轮后退出：遍历数据库里的全部故事，每个故事最多执行 `--limit` 条；`--kind` 同时限制补建与执行的任务类型。后台客户端使用 `data/channels.yaml` 的 `background` 模型，与 chat 的正文客户端分开创建；`runChatTurn` 不接受也不创建后台客户端。
- **影响**：M2-T05、M2-T06、M2-T09 只需把处理器登记进注册表，就能通过 `dramaticer work` 运行。M2-T03 结束时注册表默认为空，`work` 输出全零统计；具体任务类型随各自任务加入。

## ADR-0017 实体的身份与别名（2026-11-07）

- **背景**：M2-T04 要求实体表与别名表，供 M2-T10 的实体命中与 M2-T11 的知情者归一化使用。任务描述同时要求“同一故事内 `normalized_alias` 唯一”和“一个别名对应多个实体时返回全部”，两条约束在同一条故事内互相排斥：真实数据里角色名经常同时是某个世界书词条的主关键词，强制唯一会让其中一方在导入时失败或被错误合并。
- **决定**：
  - `entities` 以 `(story_id, normalized_name)` 唯一，表示“同一故事里的同名实体只有一行”。另外保留 `normalized_name` 列，让同名判定不依赖别名表。
  - `entity_aliases` 以 `(entity_id, normalized_alias)` 唯一，表示“同一个实体不重复登记同一个别名”。不同实体可以在同一故事里共用别名；`resolveEntities` 返回全部命中，按实体创建顺序排列。这一条取代任务描述里的“同一故事内 `normalized_alias` 唯一”。
  - 名称规范化用 `normalizeEntityName`：复用检索侧的 NFKC、去标点符号与空白，再折叠大小写。名称本身总是登记为别名，因此按名称查询与按别名查询走同一条路径。
  - `upsertEntity` 按规范化名称合并：命中已有实体时只补别名，保留原有的类型、名称与描述；新别名按规范化去重，重复导入不产生新行。所有写入按实体统计的来源写入 `source`，标题与描述不参与合并。
  - 角色卡把卡名导入为 `character`，昵称作为别名；世界书条目把注释（没有注释时用第一个可用主关键词）导入为 `lore` 名称，全部主关键词作为别名，只有标点或空白的关键词被丢弃，完全没有可用名称的条目计入 `skipped`。`dramaticer chat` 每次启动都执行一次角色卡导入，重复执行只合并。
- **影响**：M2-T13 导入世界书内容时可以直接复用别名表；M2-T10 的实体命中按别名召回多个候选实体，按实体再去召回它参与的事件与包含别名的块。M2-T11 的视角归一化需要把视角解析成实体 id 集合，命名冲突时一并保留。

## ADR-0018 分层摘要的窗口与有效性（2026-11-07）

- **背景**：M2-T06 要实现章节与主线两级摘要。摘要覆盖一段楼层区间，分支切换后覆盖旧分支的摘要不能再进入上下文；摘要的写入由后台任务触发，需要能重跑而不重复、窗口大小可调。
- **决定**：
  - schema 版本 8 新增 `summaries(row_id, id, story_id, level, start_node_id, end_node_id, text, token_count, created_at)`，`level` 只取 `chapter` 或 `mainline`，同一故事、级别、起止节点唯一；触发器拒绝起止楼层与 `story_id` 不一致的行。
  - 区间是闭区间：`start_node_id` 是覆盖的第一楼，`end_node_id` 是最后一楼。写入时要求起点是终点的祖先且起点在终点之前；只有一个楼层的区间直接拒绝，因此章节窗口至少为 2 个已确认助手楼层。
  - `isSummaryValid(summary, headNodeId)` 与 `getValidSummaries(storyId, headNodeId)` 以调用方给的节点为当前路径计算：起止节点都在这条路径上且起点在前才算有效。切到其他分支后，覆盖旧分支楼层的摘要自然消失，不删除行。
  - 章节摘要由已确认助手楼层的计数触发：路径上已确认（有子节点）的助手楼层数是 `chapterSize` 的整数倍时，窗口取上一章节终点之后到任务楼层的全部原文。上一章节按当前路径上最后一条有效章节摘要确定；没有上一章节时从路径根节点开始。`chapterSize` 默认 20，可注入。
  - 主线摘要由有效章节摘要的计数触发：章节数达到 `mainlineSize` 的整数倍且最后一条主线没有覆盖最新的章节终点时，窗口取最近的 `mainlineSize` 条章节摘要。分层摘要的上一层以章节摘要为输入，这些章节摘要都来自当前分支，因此请求不携带其他分支的内容。`mainlineSize` 默认 5，可注入。
  - 重跑判断不用任务状态，而用已有的有效摘要：章节摘要已覆盖任务楼层时不再调用模型；主线摘要已覆盖最后一条章节的终点时不再调用模型。这样模型调用失败后重试只补缺失的一级。
  - `token_count` 由存储层在写入时用 `createTokenEstimator` 计算，调用方不能传入，避免与正文不一致。
- **影响**：M2-T12 的摘要槽位直接读 `getValidSummaries`，取主线与最近一条章节；M2-T15 的评测在切换分支后重新查询，不需要额外清理摘要。

## ADR-0019 向量索引的维度、存储与渠道（2026-11-07）

- **背景**：M2-T09 要给块建立向量索引。`sqlite-vec` 的 `vec0` 虚拟表在创建时固定向量维度，而维度来自渠道配置；同一个数据库文件可能被 `work` 与 `chat` 以不同配置打开。检索还需要按故事与祖先路径过滤，否则其他故事或分支的向量会混进结果。
- **决定**：
  - schema 版本 11 新增 `chunk_vectors USING vec0(chunk_id INTEGER PRIMARY KEY, story_id TEXT, node_id TEXT, embedding float[N])`。`chunk_id` 是 `chunks.id` 的行号；`story_id` 与 `node_id` 是 vec0 的元数据列，KNN 查询直接在 `WHERE` 里按故事与节点集合过滤，不需要先取远超 limit 的候选再筛选。
  - 迁移列表由 `buildMigrations(embeddingDimensions)` 生成，默认维度 1024。`StoryStore.open(path, { embeddingDimensions })` 加载 `sqlite-vec` 扩展后应用迁移；已有数据库从 `sqlite_master` 解析实际维度，与本次配置不一致时直接抛错，避免写入一半才发现维度不符。`dramaticer work` 与 `dramaticer chat` 都传入 `embeddings.default.dimensions`。
  - `chunk_vectors` 的主键用 BigInt 绑定：`vec0` 只接受 SQLite 整数类型的绑定值，better-sqlite3 的普通 JS number 会被拒绝。
  - `EmbeddingClient` 是薄接口（`dimensions`、`embed(texts)`）。OpenAI 兼容实现负责批量、每分钟请求数限速、429/5xx 与网络错误退避重试、超时与维度校验；响应按 `index` 还原顺序，缺少条目、重复 index 与非有限数字都直接抛错。
  - 渠道配置在 `data/channels.yaml` 顶层的 `embeddings` 段，与 `channels`、`models` 平级；`apiKey` 同样必须写成 `${变量}` 引用。默认项名为 `default`，`channels.example.yaml` 给出 bge-m3 示例。
  - 后台任务类型 `embeddings` 只为任务楼层里还没有向量的块调用渠道；`dramaticer work` 只有在配置了 `embeddings.default` 时才把该类型加入默认注册表，避免没有 embedding 渠道时把任务标成失败。块文本使用原始块文本，不预先做检索规范化。
- **影响**：M2-T10 的混合检索直接调用 `searchVectors`，得到块级距离后与 BM25、实体命中一起做 RRF 融合。更换 embedding 模型且维度变化时需要重建数据库或新增迁移；当前实现选择直接报错，不静默截断向量。

## ADR-0020 取消 Gemini 原生协议的端到端验证（2026-11-07）

- **背景**：M1-T01 的 Gemini 原生适配器只确认了请求地址（`/models/<id>:streamGenerateContent` 挂在 baseUrl 根下），gcli2api 没有运行，响应兼容性没有验证；HUMAN-04 把它记录为可选待处理。人类在 2026-11-07 决定不再验证。
- **决定**：
  - 关闭 HUMAN-04，取消 gcli2api 的端到端验证。
  - ADR-0009 的适配器实现不动：Gemini 原生分支继续保留在 `core/llm` 里；OpenAI 兼容 Chat Completions 是唯一经过真实渠道验证的渠道类型。
  - 之后要接 Gemini 原生渠道时另开任务，按当时的渠道重新验证，不再把这次验证列为遗留事项。
- **影响**：M1 报告的遗留事项与 TASKS 里 M1-T01 的依赖标记同步更新；DESIGN §10 的适配器顺序不变，只标注 Gemini 原生未做端到端验证。

## ADR-0021 世界书条目的来源键与导演槽位的分支范围（2026-11-07）

- **背景**：M2-T13 要把世界书条目存成通用 lore 条目，并让 `dramaticer chat` 在没有额外参数时也能拿到卡内嵌世界书。导入会在每次 chat 启动时重跑，必须幂等；`lore_entries` 的任务字段里没有酒馆的条目键，若只按名称去重会把同一世界书里同名但内容不同的条目合并。导演槽位还需要决定：切换分支后，另一条分支上创建的未兑现笔记是否应该出现。
- **决定**：
  - `lore_entries.source` 同时承担来源描述与幂等键：世界书条目的完整来源写作 `<前缀>:<世界书名称>:<条目键>`，卡内嵌世界书写作 `character-book:<卡名>:<条目 id 或下标>`。表上 `(story_id, source)` 唯一，`insertLoreEntries` 用 `ON CONFLICT DO NOTHING` 跳过已存在的来源，重复导入不会产生新行，也不覆盖已有正文。
  - 非恒常条目的匹配只看两路：主关键词按去标点、去空白、折叠大小写后的子串命中；关联实体按名称与别名同理命中。两路都命中时实体计两分、每个关键词计一分，按分数降序、同分保持导入顺序。这个匹配不新增索引，也不调用 embedding，符合 I9 对实时决策不额外调用模型的要求。
  - 卡内嵌世界书先由 `worldInfoFromCharacterBook` 转换成与世界书文件相同的视图（`keys` → `key`、`enabled` → `disable`、`secondary_keys` → `keysecondary`），再走同一套实体与 lore 导入。`dramaticer chat` 新增可重复的 `--world <path>`，每份世界书按文件名作为世界书名称。
  - 导演槽位只注入来源楼层在当前分支路径上的未兑现笔记；楼层年龄按当前楼层与来源楼层在路径上的位置差计算。另一条分支的笔记既不出现，也不会被误算年龄。槽位不调用模型，只渲染文本。
- **影响**：M2-T14 的 `lore_lookup` 读取工具直接复用 `listLoreEntries` 与 `findEntityByName`；M2-T15 的评测需要先导入世界书条目，常驻条目会进入每一道题的上下文。世界书内容更新时不会自动覆盖已有行，需要新增明确的更新接口（当前世界书按只读处理）。

## ADR-0022 读取工具循环由 core 实现（2026-11-07）

- **背景**：M2-T14 要在主模型调用之后执行最多 2 轮读取工具。DESIGN §10 原先把 `pi-agent-core` 定为无状态单轮执行器，并计划使用它的 `prepareRequest`、`beforeToolCall`、`finishTurn` 三个钩子。`core/llm` 已经把 pi-ai 包成 `LlmStreamingClient`，路由层负责限速、重试、渠道切换、缓存与截断续写；领域层不出现 pi 类型（ADR-0010）。
- **接口冲突**：
  - `pi-agent-core` 的 `StreamFn` 必须接收 pi-ai 的 `Model` 与 `TranscriptContext`，返回 `AssistantMessageEventStream`。我们的客户端接收 `LlmRequest`、返回 `LlmStream`，没有 pi-ai 的部分消息结构；要满足这个形状，适配器必须为每个正文增量手工构造 `text_start`、`text_delta`、`text_end` 与不断增长的 `AssistantMessage`，再在结束时把 `LlmResult` 翻译回去。
  - `Agent` 自己持有对话记录、系统提示词与工具声明。我们的上下文每一轮都由 `assembleContext` 按模板重新组装，工具结果又只属于本轮。用 `prepareRequest` 替换 pi 的记录后，还要把 pi 的 `toolResult` 消息转换回 `LlmMessage` 才能让下一轮模型看到检索结果，等于维护两套消息模型。
  - 流式回调、首字计时、Trace 与中止都由现有链路负责；交给 `Agent` 后这些信号要再从 pi 的事件流读回，增加一层没有独立价值的转接。
- **决定**：
  - 不把 `pi-agent-core` 接入运行时。它继续只作为根目录 devDependency，供 `spikes/pi/` 的验证脚本使用。
  - 在 `packages/core/src/chat/executor.ts` 实现 `runModelTurns`，直接建在 `LlmStreamingClient` 上，用同样的职责划分替代三个钩子：
    - 组装好的上下文在每次请求前原样注入，工具结果追加在它后面；
    - 模型请求的读取工具在参数校验通过后才执行，未知或写入类工具不执行；
    - 每次执行读取工具记一轮，达到 2 轮后不再执行，直接结束本次生成。
  - `LlmMessage` 扩展为消息联合类型，支持助手消息携带工具调用与工具结果消息；pi-ai 适配器负责映射成 `toolCall` 与 `toolResult` 内容块，缓存键并入工具调用与结果字段。`identity: { attribution: null }` 仍在 pi-ai 适配器里设置。
  - Trace 增加 `tools`：`rounds` 是实际执行的读取工具轮数，`calls` 按调用顺序记录工具名（参数校验失败的调用也记录）。
- **影响**：DESIGN §4 与 §10 的执行器描述改为 core 实现。读取工具只在函数调用模式提供；文本标签模式不发送工具定义。工具轮次里模型先输出的过渡文本会经 `onTextDelta` 显示，但不进入楼层原文；保存的正文取最后一个没有读取工具调用的轮次。M2-T99 的 I6 复核以 Trace 的 `tools.rounds` 不超过 2、模型请求次数为 1 加工具轮数为准。

## ADR-0023 记忆评测的状态题口径与事件抽取范围（2026-11-07）

- **背景**：M2-T15 用 `retrieveMemory` 对 386 道题做命中@5/10/20 评测。实测状态题融合命中@20 为 32/236（13.6%），其中 BM25 33/236、向量 31/236、实体 9/236；事件题融合命中@5 为 125/150（83.3%）、命中@20 147/150（98.0%）。状态题的证据楼层是 MVU 变量产生变化的楼层，这些楼层的原文通常只有角色动作，变量路径与值在楼层快照里，原文检索无法命中；门槛 45% 来自 ACU 37.3% 与 BM25 8.1% 的并集，隐含了状态层，而 `retrieveMemory` 没有状态层。事件抽取需要对主路径约 1219 个已确认楼层各发一次后台模型请求；本次渠道实测约 2.7 次/分钟，完整跑完超过 7 小时，因此发布报告没有建立事件表。
- **决定**：
  - `retrieveMemory` 的楼层命中继续作为文本检索的指标原样报告：状态题 13.6% @20、事件题 83.3% @5 与 98.0% @20。状态题 45% 的门槛按文本检索口径记为未通过，不做补测或换口径掩盖。
  - 状态题在运行时由状态层回答：`getStateSnapshot` 每轮注入当前状态，读取工具 `state_get` 按路径取值。M2-T99 需要增加“状态答案正确率”（提问楼层的快照值与题目标准答案一致）作为状态层指标，并把 45% 视为文本召回目标。这会改变里程碑验收口径，已写进 HUMAN-08 请人类确认；确认前 M2-T99 标记为阻塞。
  - 不把状态路径匹配塞进 `retrieveMemory`：状态槽位每轮已经注入当前状态，用题面里的变量路径去反查 diff 会把指标变成路径查找，失去检索评测的意义。
  - 事件抽取保留为 `memory-eval --events` 的可选步骤，模型回复缓存在 `eval-private/memory-cache/llm`，中断后重跑只补缺失楼层。发布报告明确写“事件表未建立”，事件路单独成绩记 0。
- **影响**：M2-T15 的报告与门槛结果按上述口径生成；M2-T99 在 HUMAN-08 解除前不执行。事件题命中@5 未达标是真实缺口：融合结果低于单独的 BM25 路（85.3%），对话 1 与对话 3 的融合 @5 分别为 74.0% 与 78.0%，都低于各自 BM25 基线减 2 个百分点。当前 RRF 同时容纳向量与实体候选，BM25 的前几名会被挤掉；补齐事件表后需要重新跑并调整融合权重。M3 不应引用未建立事件表的数字。实体路的排序改为按规范化实体名称，保证重复导入后数字可复现。

## ADR-0024 记忆评测与文笔结构度量的数据来源分离（2026-11-07）

- **背景**：M0 与 M2 的全部指标都建立在 3 个私有对话上。对话是长短交错、以互动为主的文本，楼层长度受用户输入和模型回复习惯影响；用它测重复度、句长、对话占比与词汇丰富度，只能得到这套对话自身的分布，不能代表正常小说文本，也无法给 M3 Director 的重复检测与节奏状态机提供阈值依据。记忆类指标（状态题、事件题的召回）则需要带标准答案的评测对话，小说无法替代。
- **决定**：
  - 记忆类评测继续使用现有对话语料：状态题与事件题的题目、证据楼层、命中@K 口径不变（ADR-0023）。小说参照文本不生成记忆题目。
  - 文笔与结构类度量改用小说参照基线：重复度、句长分布、对话占比、词汇丰富度只在参照文本上统计。Foreshadowing（伏笔设置与回收）不在文本统计里做近似推断，M3 Director 用剧情笔记的兑现比例与平均年龄度量。
  - 统计口径：
    - 文本块是一行非空文本（每行一个段落）；相邻块重复度用字符 4-gram Jaccard，沿 `health/duplication.ts` 的窗口与持续上升判定，默认窗口 20 对、步长 10。
    - 句子按 `。！？!?；;…．` 与换行切分；句长只计非空白、非标点、非符号的字符；分布分档为 1–10、11–20、21–40、41–80、81+。
    - 对话占比是各类引号（`“”`、`「」`、`『』`、`""`）内字符数除以全文非空白非标点字符数。
    - 词汇丰富度用字符 bigram 类符/形符比（不同相邻字符对数量除以全部相邻字符对数量），同时报告字符类符/形符比。仓库没有中文分词依赖，不引入分词器。
  - 数据来源与公开范围：公有领域作品可以作为仓库测试数据（现有 fixture 为《论语》与唐诗选段）；版权作品只能放在 `eval-private/reference/`，不进入提交、测试数据、文档或日志，agent 不联网下载。私有报告 `eval-private/reports/reference.md` 可以出现文件名与作品名；统计版 `docs/dev/reports/reference-baseline.md` 只列“作品 1..N”与数字，不出现版权作品名称、文件名或原文。
  - 输入格式为 UTF-8 的 `.txt` 或 `.md`，每行一个段落；`eval-private/reference/` 不存在或为空时脚本仍然生成报告，并把私有作品数记为 0。
- **影响**：新增 `pnpm --filter @dramaticer/st-compat reference`，输出两份报告；D-T04 用这套数字定 Director 阈值，阈值不得从对话语料直接得出。M3 的重复检测与节奏任务依赖 D-T04。参照文本只做统计，不进 prompt、不进评测集。

## ADR-0025 Director 阈值来源：参照小说基线与评测对话对照（2026-11-07）

- **背景**：D-T04 要对 `eval-private/reference/` 的 5 部作品运行 D-T03 的统计，给 M3 的重复检测与节奏状态机提供阈值来源。参照文本共 1,619,615 个内容字符、30,212 个文本块；评测对话（旧语料 3 个）另用同一套口径统计，只作对照。
- **实测分布**：
  - 相邻块 4-gram Jaccard（每行一个文本块）：5 部小说均值 0.0018–0.0030，P95 0.0122–0.0176，P99 0.0387–0.0476；汇总（含公有领域 fixture）P95 0.0164、P99 0.0423。峰值可达 1.0，来自重复出现的短行（标题、分隔句），因此阈值取分位，不取峰值。
  - 句长（去掉空白、标点与符号）：均值 22.72–29.68 字，中位数 17–26，P90 47–64；41 字以上的句子占 13.9%–24.4%。
  - 对话占比：27.0%–37.2%，汇总 31.7%。
  - 词汇丰富度：字符 TTR 0.0058–0.0474，二元组 TTR 0.2246–0.4791。
  - 连续块：含对白的连续块中位数 1–2、P90 6–9、最长 18–46；不含对白的连续块中位数 1–2、P90 4–8。汇总 P90 分别为 7 与 6。
  - embedding 余弦（`BAAI/bge-m3@1024`，每个作品按固定步长取 100 对相邻块，共 500 对、991 段文本）：均值 0.5256，P50 0.5218，P90 0.6473，P95 0.6760，P99 0.7324；各作品均值 0.5157–0.5352，分布稳定。
  - 评测对话对照（3 个对话、582 条助手回复、579 对相邻回复）：Jaccard 均值 0.1105–0.1213（合计 0.1176），P95 0.1981–0.2369（合计 0.2150）；句长均值 22.54–40.13；对话占比 13.6%–20.5%；二元组 TTR 0.0920–0.1481。对话的相邻重复度约为小说的 40 倍（0.1176 / 0.0029），P95 约为 13 倍（0.2150 / 0.0164），词汇丰富度更低，对白更少。
- **决定**：
  - 重复检测（M3-T06）的窗口参数沿用 D-T03 的分析分辨率：`windowSize = 20` 对、`step = 10`、`riseWindows = 5`。绝对阈值取参照余弦分布的 P99，即 `similarityThreshold = 0.73`；判定要求窗口均值高于该阈值并且窗口均值连续上升（`riseDelta = 0.02`、`riseMinimum = 0.03`，沿用 `health/duplication.ts` 的语义）。单个相邻对的高值不触发，峰值 1.0 的重复短行也不会单独触发。
  - 评测对话的重复度高于参照 P99，这是互动文本与小说的真实差异。Director 的触发条件因此以“上升”为主、绝对阈值为底线；阈值仍然只从参照文本取得，不按对话语料抬高。
  - 场景类型循环没有参照标签，D-T04 不推导场景阈值；M3-T06 的 `sceneRepeatThreshold` 取连续含对白块的 P90，即 7，并在 T08 回放中检验。
  - 节奏状态机（M3-T07）的持续时间取连续块分布的 P90：`climaxFloors = 7`（连续含对白块）、`breatheFloors = 6`（连续无对白块）；假设一个文本块约等于一个节拍楼层，这个近似在 T08 回放中检验。`pace` 默认 1.0。
  - 张力阈值不由参照文本推导：小说没有状态 diff、剧情笔记与事件重要度这些信号，硬套文本数字会制造没有依据的阈值。T07 的张力代理在 [0,1] 上取三等分点 `tensionEscalate = 0.33`、`tensionClimax = 0.67`，并在 T08 回放中检查各阶段是否可达；不可达时调整公式权重，而不是改用小说数字。
  - 余弦校准结果缓存在 `eval-private/reports/reference-cosine.json`，由 `pnpm --filter @dramaticer/st-compat reference:cosine` 生成；不运行校准时两份报告写明“未运行 embedding 余弦校准”。校准时按文本内容缓存 embedding，重复运行不重复调用渠道。
  - 统计版报告只出现“作品 1..N”与数字；私有版报告可以出现文件名与作品名。对话对照只出现“对话 1..N”，不出现角色名或对话名。
- **影响**：M3-T06 直接使用上述窗口、上升规则与 0.73 余弦阈值，配置默认值写入 core 的 Director 配置；M3-T07 使用 7 与 6 的持续时间，张力阈值按本 ADR 的说明处理，T07 的任务描述同步修改。M3-T08 的重复度报告要同时给出词面 Jaccard 与余弦两组数字。Director 阈值不得从评测对话重新推导；参照文本仍然不进 prompt、不进评测集。
