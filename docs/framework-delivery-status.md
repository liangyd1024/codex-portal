# 框架迁移当前交付审计

本页是当前状态入口。历史验证保留在专项报告与[持续记录](verification-framework-parity.md)中；历史段落里的“当前版本”仅指当时版本。**整份迁移计划尚未完成，不能合并或正式上线。**

## 当前版本与运行边界

| 对象 | 核验结果 |
| --- | --- |
| 重构分支 | `refactor/framework-migration`，独立 worktree；本次审计前工作区干净 |
| 正式网页 4317 | `227dbfe93ee88718c2437f7b7c7b119570a720a6`，版本接口 200 |
| 最新 origin/master | `0a3ee2ac8c97cafa89870d78323cf0dfc2f3692e`；已重新 fetch，相对 4317 只有部署记录的四行文档差异 |
| 独立预览 4327 | `eb1eb6e5b2699ab0fe509843fd5294f527dca28d`，版本接口 200；手机沿用 4338／4339 |
| 最新已构建候选 | `eb1eb6e`，dirty=false，资源 `d182128aa18aae911a16bb16036da6c137d38246cd698aea1f3f8c91bff5d72e`；已更新真实预览，见 [主控制器类型迁移](verification-framework-controller-types.md)；此前 `accb11f` 全部历史结果保留其原版本范围 |
| 本轮预览更新 | 已包含侧栏读取、轮次文字优化、会话选择与详情应用、请求回答协调迁移，以及连接设置同步发布合并和操作协调器、新建页和工作台启动协调类型迁移，以及账号标签和模型选项重复发布优化、会话控制上下文和连接启动类型迁移，以及连接摘要同步提交合并、排队编辑瞬时禁用后的焦点修复，以及目标工具栏快速失败后的焦点修复，以及模型与思考档位禁用状态同步提交合并、引用高亮层首次挂载合并，以及侧栏浮层首次显示挂载，以及 SSE 连接协调、页面生命周期和主控制器类型迁移；四种视口的真实入口启动与抽屉检查通过，尚非全功能集成验收 |
| 更新限制 | 本轮重新检查各连接待处理请求均为零，已仅更新独立预览；没有豁免请求或停止原生会话 |

构建 manifest 的 baseline 字段仍记录分支起点 `1a149a7`，不代表本轮对照版本。正式 4317／4318／4319、本地 master 及原生引擎均未因本轮审计修改。

## 原计划要求与证据

| 要求 | 已有证据 | 当前判定与缺口 |
| --- | --- | --- |
| 独立分支、worktree、串行提交与推送；不合并、不正式部署 | Git 状态、历史提交、运行版本 | 已执行；后续保持 |
| 精确锁定依赖、禁用安装脚本、独立输出目录与 JS 启动入口 | package.json、锁文件、scripts/typecheck.mjs、build-framework.mjs、start-preview.mjs | 工程边界已实现；未执行正式安装 |
| React + TypeScript、Zustand、Vite，按模块组织 | src/web/entry.tsx、components、services、state.ts | 主控制器已迁入严格 TS；其余旧 UI 协调代码尚未全部迁移，见下表 |
| DOM 子树由一个渲染器管理，保留消息解析和节点协调 | 已有组件通过独立 store 或组件内原生适配控制；消息算法仍保留 | 部分实现；Shell 内若干静态节点仍由 controller.ts 写属性或内容，需要明确组件边界并收敛 |
| 原 CSS、加载顺序、类名、变量和媒体查询不变 | framework-http 的构建 CSS 字节与顺序测试；专项样式比较 | CSS 契约已检查；全功能所有视觉状态不能仅据此判为通过 |
| Node + TypeScript + Fastify，路由及应用服务拆分 | src/server/application.ts、core.ts、http.ts、routes、services | 结构已实现；不再笼统列为“尚未拆分服务端” |
| HTTP／JSON／SSE、鉴权顺序、文件流与错误契约保持 |test/framework-http.test.mjs 的连接、会话、工作区、文件、媒体、桌面、访问、系统、请求与静态资源差分；[原始正式源码接口复核](verification-framework-original-baseline-http.md)另对实际 `227dbfe` 导出源码与 `accb11f` 指定构建运行 30 项检查 | 模拟协议覆盖已建立；[当前真实服务复核](verification-framework-live-boundaries.md)已在实际 `accb11f` 复验 HTTP、安全边界、SSE 客户端隔离及手机未配对 HTTPS，共 22 组 HTTP／HTTPS 对照及六个 SSE 测试客户端；其中 CSRF 只向不存在的路径探测，不执行业务操作；不等于真实业务全部完成 |
| 禁止框架默认解析、类型转换、填默认值及裁剪字段 | http.ts 在 onRequest 接入兼容分发；关闭转换并拒绝意外 Schema 编译 | 代码与回归具备证据；保留公共协议层 |
| 复用 RPC、IPC、SSH、Python；不替代原生执行语义 | core 与 services 调用既有 lib 适配器，原生 payload 保持透传 | 边界保持；[既有适配源码核对](verification-framework-native-adapter-parity.md)确认 42 个既有 lib 模块的运行逻辑保留，实际预览副本与审计源码一致；正式与预览配置经相同加载规则后一致；当前 SSH 运行状态不同，hostname／version 响应差异在真实接口报告中单独保留；预览严格 SSH 身份检查及真实读取已通过；[真实单轮往返](verification-framework-ssh-native-roundtrip.md)补齐创建、发送、事件回传、历史、四视口展示及交还，远端引擎未重启；另已完成真实文本文件的四模式传输与四视口预览、下载；远程排队、目标、大文件及二进制等完整范围仍未验 |
| 原文、未知字段、连接 ID、存储键和草稿兼容 | API、事件、合并、草稿及各服务回归；未做数据格式迁移 | 有限定行为证据；还需最终集成检查，不能泛化为所有原生能力已验 |
| 4327／4338／4339 与正式环境隔离 | preview-mobile、Cookie 隔离、真实接口安全对照；独立状态、证书、日志和配对目录 | 已运行；最新候选已进入真实预览；Tailscale 系统转发在预览中明确受限 |
| 网页功能和 iPhone 竖屏／横屏／短高度一比一 | 各专项报告分别列明基准、资源、尺寸、触控及样本 | 已覆盖大量流程，但版本和范围分散，未完成最新候选全量集成收口 |
| 输入、中文组合、快捷键、剪切粘贴、撤销、附件、误发送 | 输入与附件专项、Node 行为回归和设备模拟；[当前候选集成复核](verification-framework-input-attachments-current.md)补充 83 组输入、键盘草稿及附件四视口对照 | 模拟验证不能替代实体候选窗、系统选区和剪贴板；真实设备项仍缺证据 |
| 原文、流式、历史前插、锚点、选区、迟到响应、恢复 | 流式、侧聊、历史、SSE、草稿专项；[当前侧聊复核](verification-framework-side-chat-current.md)补充四视口草稿、附件、发送与迟到响应，以及桌面鼠标附件共 102 组对照 | 有限定通过结果；[当前候选恢复复核](verification-framework-recovery-current.md)确认原生 SSE 断流重连一致，模拟离线的输入停滞和惯性前插跳动仍为两版共有问题；其余集成范围继续复核 |
| 本机／SSH、项目／目标／问题／任务／文件／通知／配对／维护 | 协议差分、隔离 UI 与限定本机真实会话 | 原生定时任务管理执行、持续 SSH、实体手机等不能凭模拟或只读结果标为完成 |
| 性能与 CPU／内存／磁盘资源 | 输入、列表、流式、首屏及 Fastify 专项样本 | 未通过整体门槛；存在波动、历史稳定差异及资源成本缺口；[当前首屏资源测量](verification-framework-startup-resources.md)记录候选脚本 CPU 和静态体积增加，并在 `8362c3d` 复测定位普通首次 pageshow 可能触发的共同重复恢复读取；[连接设置优化](verification-framework-connection-settings-batch.md)已减少每次状态切换的一次 React 提交，[账号标签优化](verification-framework-account-publication.md)减少启动样本三次无变化提交，[模型选项优化](verification-framework-model-publication.md)另减少模型发布三次提交；[连接摘要同步提交合并](verification-framework-connection-summary.md)在同一会话的校准样本中通常再减少一次提交，同步耗时未稳定改善；[模型禁用状态合并](verification-framework-model-availability-batch.md)减少连接变化时的一次提交，跨设备耗时仍未稳定改善；此前 `accb11f` 首屏复测仍显示桌面及手机脚本计数偏高：中位数分别为基准 68.19／67.43 ms、候选 82.61／82.02 ms；等请求数样本差距仍存在，当前记录到 72 次启动提交，但未证明整体性能通过，禁止宣称整体提速 |
| 类型检查、完整 npm test、构建产物验证、报告 | 最近完整回归：902 Node／74 Python；应用代码的 typecheck、构建通过，干净资源与候选一致 | 当前回归通过；不替代迁移完整性及全量验收 |

## 尚需完成的实现

| 工作项 | 当前源码证据 | 完成条件 |
| --- | --- | --- |
| 主控制器类型化 | entry.tsx 加载 src/web/controller.ts；public/app.js 保留 JS 导入入口；native 已知字段及未知字段契约纳入严格检查 | 本轮完成主控制器类型化，60 项相关及完整 902／74 项回归通过；24 组生命周期和 27 组输入对照一致，见[报告](verification-framework-controller-types.md)；实际预览已更新到 eb1eb6e，并通过四视口真实入口启动检查 |
| 剩余 UI 控制器边界 | public/sidebar.js、composer.js、goal-toolbar.js、mobile-ui.js、turn-navigation.js 仍含控制逻辑；多个 React 视图已安装，但控制器语言和所有权并未全部收敛 | 区分应用协调与确需保留的 DOM／浏览器适配；逐模块提供类型契约并验证行为，不能仅按扩展名宣称完成 |
| Shell 静态节点与运行属性 | Shell.tsx 创建搜索框、更多会话按钮、会话标题、控制说明、输入框等，controller.ts 仍直接修改相关内容／属性 | 明确每个节点的唯一运行期所有者；迁移时保留 IME、焦点、选区、触控、滚动和事件顺序 |
| 正文算法稳定容器 | 原解析、缓存与协调算法保留，主控制器仍协调消息区域 | 将协调边界类型化并保持稳定容器；不为迁移重建正文或改变原文 |
| 启动失败恢复边界 | public/bootstrap.js 在应用模块加载前提供超时、重试和网络恢复；test/bootstrap.test.mjs 覆盖该阶段 | 保留不依赖 React 成功加载的恢复能力；不能机械地把此入口搬进尚未加载的组件 |

在 `c1f0d65` 版本临时将 app.js 置于严格 TS 审计时有 430 条诊断，其中 1 条为临时审计未复现构建中 shared 路径映射造成的模块解析问题，余项包含隐式类型、可空性、参数及契约问题。该审计位于仓库外，不是正式 typecheck 失败，也不是 430 个运行错误。正式 tsconfig 使用 strict=true，但保留的 JavaScript 为 checkJs=false，当时正式 typecheck 通过不能证明主控制器已经类型化。本轮已将主控制器实际移入 TS 并通过正式严格检查；历史诊断计数仅保留作追溯，不代表当前待处理数量。

## 后续收口顺序

1. 会话选择与详情应用已经完成专项迁移，见[报告](verification-framework-thread-selection.md)。请求回答协调也已完成专项迁移，见[报告](verification-framework-request-response.md)。工作台 init 也已完成[专项迁移](verification-framework-workspace-startup.md)。会话控制状态已完成[类型迁移](verification-framework-session-context.md)，连接配置启动读取已完成[类型迁移](verification-framework-connection-bootstrap.md)，主控制器现已完成[严格 TS 迁移](verification-framework-controller-types.md)，继续收敛剩余 UI 控制器及 Shell 运行属性；每次迁移对照相应旧版流程。
2. 保留原生正文算法和独立启动恢复入口，核实其稳定容器及适配契约。服务端后续重点转为真实行为和资源验收，不重复进行已经完成的路由拆分。
3. 本轮已在待处理请求为零时更新独立预览，桌面和手机模式启动检查通过。后续每次更新仍须重新检查，不得靠回答不属于本任务的请求或打断会话解除限制。
4. 在同一最终候选上收口功能、视觉、输入、滚动、断线恢复、SSH 与手机验证。`dc4bba1` 已完成[限定集成对照](verification-framework-candidate-integration.md)，后续 `ca2864a` 与 `9e7e5d9` 分别补做账号、模型专项和真实入口检查，`3e37b0b` 补做会话状态及维护流程四视口对照和真实入口检查，`8362c3d` 补做连接选择与启动失败恢复四视口对照和真实入口检查，`7eb6eb3` 补做连接摘要、维护和状态四视口对照及真实入口检查，并完成当前输入、键盘草稿和附件集成复核，以及侧聊控制、主侧同时带图发送隔离和迟到刷新复核；[当前问题回答复核](verification-framework-questions-current.md)继续补齐原生问题与异步问题四视口集成对照；[当前审批卡片复核](verification-framework-approvals-current.md)补齐决策分支、断线与等待状态；`17a7dd4` [修复排队编辑焦点](verification-framework-queue-editor-focus.md)，并在正常调试环境复验四视口编辑、迟到响应和发送路径，保留共有刷新失焦及时序差异记录；`710803f` [修复目标工具栏清除失败焦点](verification-framework-goal-controls-current.md)，并补验目标编辑、状态、无变化保存及跨会话迟到响应；同一候选的[正文文件与通知复核](verification-framework-files-notifications-current.md)补充四视口共 88 组文件清单、通知设置及模拟自动通知对照；[文件预览与输出下载复核](verification-framework-file-viewer-current.md)另补充 32 组预览状态和 4 组真实浏览器完整输出下载对照；[媒体预览复核](verification-framework-media-preview-current.md)补齐 44 组图片、音视频、PDF 及损坏文件状态对照与 16 组真实媒体下载；`41605a7` [合并模型禁用状态提交](verification-framework-model-availability-batch.md)，完成 40 组四视口模型行为对照和真实入口启动检查；同一候选的[媒体播放操作](verification-framework-media-playback-current.md)补充 48 组实际播放、暂停、点击定位和关闭清理对照；[浏览器备份复核](verification-framework-browser-backup-current.md)补充 48 组导出、目标校验、取消、失败回滚、成功导入及等待保护对照；[计划卡片复核](verification-framework-plan-controls-current.md)补充同一候选 92 组常规提交、断线、立即拒绝、重复保护和跨会话迟到回执对照；[定时任务入口复核](verification-framework-automations-current.md)补充同一候选 80 组列表、筛选、详情、刷新及管理草稿对照；`1d4b282` [合并引用高亮层首次挂载](verification-framework-mention-initial-mount.md)，完成 184 组输入引用对照与真实入口启动检查，启动提交减少两次，耗时未稳定改善；`e1a5f0c` [侧栏浮层首次显示挂载](verification-framework-sidebar-overlay-mount.md)完成 165 组对照和真实入口检查，保留启动提交与首次打开耗时波动；同一候选的[工作台连续操作与刷新恢复](verification-framework-workspace-journey-current.md)补充 72 组跨会话、新建草稿、附件和任务详情往返对照；同一候选另已重新执行[输入与附件](verification-framework-input-attachments-current.md)的 83 组四视口对照，以及[问题回答](verification-framework-questions-current.md)的 96 组四视口对照；同一候选的[跨目标草稿与历史导航](verification-framework-connection-scope-current.md)补充 44 组界面与存储对照，15 组读取序列差异保留待查，未发生目标范围违规；`7241964` [跳过重复空请求卡片发布](verification-framework-request-empty-publication.md)，完成 192 组问题与审批对照，并追加主侧聊双卡片 48 组稳定状态对照；位置差异复查确认两版均存在工具滚轮路径波动，另以聚焦后键盘输入完成 36 组一致对照，原始失败记录保留。启动少一次提交但耗时没有证明改善；`accb11f` [迁移请求卡片协调层](verification-framework-request-renderer.md)，完成 228 组四视口对照及 888 项 Node／74 项 Python 回归；待处理请求归零后已更新真实预览，并完成[真实 SSH 只读复核](verification-framework-preview-ssh-retry.md)。同一 `accb11f` 候选另完成跨目标与历史导航 44 组四视口界面对照，追加 6 组诊断对照；16 组请求序列差异中恢复读取来源已定位，四组额外详情读取的原始调度来源仍未直接记录；新增三组可控时序差分确认 master 与候选的延迟刷新、请求合并和迟到响应保护一致。当前候选另完成[历史与流式正文复验](verification-framework-history-stream-current.md)：20 组分页、32 组流式正文、24 组焦点样式对照一致；三种手机视口保留 master 共有的惯性跳动，未标为滚动稳定通过。同一候选另复验四视口连续 SSE 重连及离线流程，并对真实 4317／4327 验证关闭单个客户端不影响其他心跳；共有离线输入停滞仍保留。同一候选已追加文件预览 32 组、实际输出下载 4 组、通知设置 36 组和自动通知逻辑 24 组对照，均一致；通知权限及投递为隔离模拟。同一候选已完成媒体播放 64 组四视口对照，新增自然结束及从头重播检查，无候选差异；扬声器、全屏及断网范围仍未验。同一候选另补验定时任务入口：列表首轮 48 组中 5 组存在关闭菜单节点计算样式差异，桌面及横屏追加 30 组全部一致；菜单和管理草稿 32 组、未绑定会话选择器 44 组一致。原始差异保留，未泛化为真实任务执行通过。同一候选另完成一百项选择器 40 组对照及浏览器备份 48 组对照；备份比较保留原始导出并仅标记两类动态缓存时间，未改写缓存正文。另完成[目录首次挂载试验](verification-framework-catalog-mount-experiment.md)：144 组行为对照一致，启动少两次提交，但未测得耗时收益，试验代码已撤回；不得将该试验构建结果计入实际运行版本的全量通过。同一实际候选已另完成计划卡片 92 组四视口对照，提交次数、草稿、迟到回执及样式一致。同一候选另复验排队编辑与操作共 154 组：149 组完整一致，保留五组自然刷新时序下的焦点差异；八个受控刷新流程均确认两版旧按钮断开后失焦，未改写基准刷新策略。仍须在最终候选上完成全量对照，首屏复测未通过性能门槛。历史证据可作为回归依据，不能把不同基准的结果拼成一次全量通过。
5. 解决稳定性能退化并补齐资源测量，记录剩余外部限制。只有全部原计划门槛有对应证据，才能标记本轮交付完成；合并 master 和正式上线仍不在本轮范围。

另完成[输入工具状态合并试验](verification-framework-composer-batch-experiment.md)：输入 27 组、主附件 32 组、主侧聊附件 24 组对照一致；工具菜单 60 组中保留 20 组关闭后节点背景色差异，未判为视觉通过。试验启动提交从 72 降为 70，但耗时没有确认收益，因此应用改动已撤回，恢复构建资源与实际预览一致。该试验不计入当前候选的全量通过，也未触发服务更新。

实际 `accb11f` 候选另完成[输入工具菜单复核](verification-framework-composer-controls-current.md)：84 组四视口对照中 73 组完整一致，11 组差异仅为两版均不可见节点的计算背景色；24 组重新打开菜单的完整状态及样式一致。原始差异保留，没有反向改写已撤回试验的结论。

实际 `accb11f` 候选另完成[工作台连续操作及刷新恢复复验](verification-framework-workspace-journey-current.md)：四视口 72 组完整对照一致，三份草稿、图片归属、输入框身份和刷新落点均有独立断言，未执行真实业务写入。

实际 `accb11f` 候选另完成[媒体预览复验](verification-framework-media-preview-current.md)：四视口 44 组完整状态对照、16 组真实浏览器下载对照一致；八张 PDF 截图均确认内容显示，损坏视频错误与重试、关闭后的媒体清理一致。此结果不扩展为真实 SSH 二进制传输或实体手机验证。

实际 `accb11f` 候选另完成[目标控件复验](verification-framework-goal-controls-current.md)：工具栏 68 组、编辑器 24 组、跨会话迟到响应 32 组交互对照及四组结构对照一致。快速清除失败焦点、无变化零写入、主动移焦与新草稿保护有独立断言；不等同于真实原生目标管理通过。

当前目标编辑器另补 60 组完整流程：界面、草稿及写请求一致，结果未知后的读取确认没有重复写入；iPhone 竖屏从首次打开起累计多一次详情读取，十五个阶段保留该计数差异。四次启动调用栈诊断均为六次读取，未再次捕获多出的请求，来源仍待查，未将网络行为标为完全一致。

上述读取差异另补时序诊断：四次新旧浏览器样本首次均为六次，停止操作等待后均通过 1000＋650 ms 延迟链路变为七次，请求序列一致；基准原函数与候选的三项可控时序测试各自通过。该证据确认共有补读行为，原差异样本缺少调用栈，仍不将其唯一原因或整体性能标为已解决。

实际 `accb11f` 候选另完成[技能与插件目录复核](verification-framework-catalog-current.md)：四视口 144 组配对一致，覆盖主会话、侧聊、失败重试、空目录、去重、搜索及条目变化。迟到响应在确认旧正文消费后检查，未覆盖新目录。这是实际候选的新执行证据，没有沿用撤回试验的结果。

审计本身不替代应用验证。应用改动与验证范围以对应专项报告为准；本页依据当前源码、回归日志、Git／构建状态及版本接口更新。

本轮另完成 [SSE 连接协调类型迁移](verification-framework-event-connection.md)：正式原函数和新模块各通过五项行为断言，最新构建完成四视口 12 组断流恢复对照（共 24 次恢复），完整状态一致；完整回归 896 Node／74 Python 通过。当前正式基准未变化。SSH 最新重试再次超时，历史成功不代表当前可用。提交 `5315953` 的干净资源已更新独立预览，重新检查待处理请求为零后执行；真实本机入口的八个启动样本及两种 390px 抽屉触控通过。首轮默认恢复 SSH 导致等待连接超时，单独保留为受限结果。整体性能与迁移完整性仍未收口。

本轮另完成 [页面生命周期类型迁移](verification-framework-workspace-lifecycle.md)：迁移前装配块及新模块各通过六项行为断言；最新构建的四视口 24 组生命周期状态、四组离线流程对照一致。两版共有的离线输入停滞仍保留。完整回归 902 Node／74 Python 通过；提交 `2dd1d23` 的干净资源已更新真实预览；四视口共八个本机入口启动样本及两种 390px 抽屉触控通过。未宣称整体性能通过。

另完成 [三类空视图延迟注册试验](verification-framework-empty-portal-experiment.md)：八个诊断样本的启动提交从 72 次降为 66 次，但 16 次首屏样本没有测得耗时收益；八个首次显示流程只有限定结构与焦点检查，不能作为全功能通过。试验代码已撤回，恢复后的资源与实际 2dd1d23 一致，未更新服务。

本轮另完成[主控制器 TypeScript 迁移](verification-framework-controller-types.md)。新构建资源为 `d182128aa18aae911a16bb16036da6c137d38246cd698aea1f3f8c91bff5d72e`，提交 eb1eb6e 后已核对干净构建指纹并更新真实预览，四视口八个真实启动样本通过。当前 SSH 重试仍超时，不能标为通过。
