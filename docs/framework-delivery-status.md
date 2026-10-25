# 框架迁移当前交付审计

本页是当前状态入口。历史验证保留在专项报告与[持续记录](verification-framework-parity.md)中；历史段落里的“当前版本”仅指当时版本。**整份迁移计划尚未完成，不能合并或正式上线。**

## 当前版本与运行边界

| 对象 | 核验结果 |
| --- | --- |
| 重构分支 | `refactor/framework-migration`，独立 worktree；本次审计前工作区干净 |
| 正式网页 4317 | `227dbfe93ee88718c2437f7b7c7b119570a720a6`，版本接口 200 |
| 最新 origin/master | `0a3ee2ac8c97cafa89870d78323cf0dfc2f3692e`；已重新 fetch，相对 4317 只有部署记录的四行文档差异 |
| 独立预览 4327 | `17a7dd46d7f868ce08c54fac24ad0a74f13989ff`，版本接口 200；手机沿用 4338／4339 |
| 最新已构建候选 | `17a7dd4`，dirty=false，资源 `f540c33b2c08c898410c24cddcc9de61467eede255ccd966055861c5ba12b2d7` |
| 本轮预览更新 | 已包含侧栏读取、轮次文字优化、会话选择与详情应用、请求回答协调迁移，以及连接设置同步发布合并和操作协调器、新建页和工作台启动协调类型迁移，以及账号标签和模型选项重复发布优化、会话控制上下文和连接启动类型迁移，以及连接摘要同步提交合并、排队编辑瞬时禁用后的焦点修复；四种视口的真实入口启动与抽屉检查通过，尚非全功能集成验收 |
| 更新限制 | 本轮独立预览所有连接的待处理请求为零，维护检查通过后更新；没有豁免请求或停止原生会话 |

构建 manifest 的 baseline 字段仍记录分支起点 `1a149a7`，不代表本轮对照版本。正式 4317／4318／4319、本地 master 及原生引擎均未因本轮审计修改。

## 原计划要求与证据

| 要求 | 已有证据 | 当前判定与缺口 |
| --- | --- | --- |
| 独立分支、worktree、串行提交与推送；不合并、不正式部署 | Git 状态、历史提交、运行版本 | 已执行；后续保持 |
| 精确锁定依赖、禁用安装脚本、独立输出目录与 JS 启动入口 | package.json、锁文件、scripts/typecheck.mjs、build-framework.mjs、start-preview.mjs | 工程边界已实现；未执行正式安装 |
| React + TypeScript、Zustand、Vite，按模块组织 | src/web/entry.tsx、components、services、state.ts | 部分实现；主控制器及旧 UI 协调代码仍未全部迁移，见下表 |
| DOM 子树由一个渲染器管理，保留消息解析和节点协调 | 已有组件通过独立 store 或组件内原生适配控制；消息算法仍保留 | 部分实现；Shell 内若干静态节点仍由 app.js 写属性或内容，需要明确组件边界并收敛 |
| 原 CSS、加载顺序、类名、变量和媒体查询不变 | framework-http 的构建 CSS 字节与顺序测试；专项样式比较 | CSS 契约已检查；全功能所有视觉状态不能仅据此判为通过 |
| Node + TypeScript + Fastify，路由及应用服务拆分 | src/server/application.ts、core.ts、http.ts、routes、services | 结构已实现；不再笼统列为“尚未拆分服务端” |
| HTTP／JSON／SSE、鉴权顺序、文件流与错误契约保持 | test/framework-http.test.mjs 的连接、会话、工作区、文件、媒体、桌面、访问、系统、请求与静态资源差分 | 模拟协议覆盖已建立；[当前真实服务复核](verification-framework-live-boundaries.md)补充只读 HTTP、安全边界、SSE 客户端隔离及手机未配对 HTTPS；不等于真实业务全部完成 |
| 禁止框架默认解析、类型转换、填默认值及裁剪字段 | http.ts 在 onRequest 接入兼容分发；关闭转换并拒绝意外 Schema 编译 | 代码与回归具备证据；保留公共协议层 |
| 复用 RPC、IPC、SSH、Python；不替代原生执行语义 | core 与 services 调用既有 lib 适配器，原生 payload 保持透传 | 边界保持；真实 SSH 完整链路仍未通过 |
| 原文、未知字段、连接 ID、存储键和草稿兼容 | API、事件、合并、草稿及各服务回归；未做数据格式迁移 | 有限定行为证据；还需最终集成检查，不能泛化为所有原生能力已验 |
| 4327／4338／4339 与正式环境隔离 | preview-mobile、Cookie 隔离、真实接口安全对照；独立状态、证书、日志和配对目录 | 已运行；最新候选已进入真实预览；Tailscale 系统转发在预览中明确受限 |
| 网页功能和 iPhone 竖屏／横屏／短高度一比一 | 各专项报告分别列明基准、资源、尺寸、触控及样本 | 已覆盖大量流程，但版本和范围分散，未完成最新候选全量集成收口 |
| 输入、中文组合、快捷键、剪切粘贴、撤销、附件、误发送 | 输入与附件专项、Node 行为回归和设备模拟；[当前候选集成复核](verification-framework-input-attachments-current.md)补充 83 组输入、键盘草稿及附件四视口对照 | 模拟验证不能替代实体候选窗、系统选区和剪贴板；真实设备项仍缺证据 |
| 原文、流式、历史前插、锚点、选区、迟到响应、恢复 | 流式、侧聊、历史、SSE、草稿专项；[当前侧聊复核](verification-framework-side-chat-current.md)补充四视口草稿、附件、发送与迟到响应，以及桌面鼠标附件共 102 组对照 | 有限定通过结果；[当前候选恢复复核](verification-framework-recovery-current.md)确认原生 SSE 断流重连一致，模拟离线的输入停滞和惯性前插跳动仍为两版共有问题；其余集成范围继续复核 |
| 本机／SSH、项目／目标／问题／任务／文件／通知／配对／维护 | 协议差分、隔离 UI 与限定本机真实会话 | 原生定时任务管理执行、持续 SSH、实体手机等不能凭模拟或只读结果标为完成 |
| 性能与 CPU／内存／磁盘资源 | 输入、列表、流式、首屏及 Fastify 专项样本 | 未通过整体门槛；存在波动、历史稳定差异及资源成本缺口；[当前首屏资源测量](verification-framework-startup-resources.md)记录候选脚本 CPU 和静态体积增加，并在 `8362c3d` 复测定位普通首次 pageshow 可能触发的共同重复恢复读取；[连接设置优化](verification-framework-connection-settings-batch.md)已减少每次状态切换的一次 React 提交，[账号标签优化](verification-framework-account-publication.md)减少启动样本三次无变化提交，[模型选项优化](verification-framework-model-publication.md)另减少模型发布三次提交；[连接摘要同步提交合并](verification-framework-connection-summary.md)在同一会话的校准样本中通常再减少一次提交，同步耗时未稳定改善；但未证明整体性能通过，禁止宣称整体提速 |
| 类型检查、完整 npm test、构建产物验证、报告 | 最近应用代码：884 Node／74 Python、typecheck、构建通过；干净资源与候选一致 | 当前回归通过；不替代迁移完整性、真实预览更新及全量验收 |

## 尚需完成的实现

| 工作项 | 当前源码证据 | 完成条件 |
| --- | --- | --- |
| 主控制器类型化 | entry.tsx 最后仍导入 public/app.js；app.js 953 行，仍包含事件装配及渲染协调；会话选择与详情应用已迁入 thread-selection.ts，请求回答已迁入 request-response.ts，操作去重和失败协调已迁入 action-runner.ts，新建页打开／关闭及项目选择已迁入 new-chat-page.ts，工作台 init 已迁入 workspace-startup.ts，会话控制状态已迁入 session-context.ts，连接启动读取已迁入 connection-bootstrap.ts | 相应应用协调迁入严格 TS；原算法、存储与请求顺序保留；不以关闭检查或宽泛类型掩盖诊断 |
| 剩余 UI 控制器边界 | public/sidebar.js、composer.js、goal-toolbar.js、mobile-ui.js、turn-navigation.js 仍含控制逻辑；多个 React 视图已安装，但控制器语言和所有权并未全部收敛 | 区分应用协调与确需保留的 DOM／浏览器适配；逐模块提供类型契约并验证行为，不能仅按扩展名宣称完成 |
| Shell 静态节点与运行属性 | Shell.tsx 创建搜索框、更多会话按钮、会话标题、控制说明、输入框等，app.js 仍直接修改相关内容／属性 | 明确每个节点的唯一运行期所有者；迁移时保留 IME、焦点、选区、触控、滚动和事件顺序 |
| 正文算法稳定容器 | 原解析、缓存与协调算法保留，主控制器仍协调消息区域 | 将协调边界类型化并保持稳定容器；不为迁移重建正文或改变原文 |
| 启动失败恢复边界 | public/bootstrap.js 在应用模块加载前提供超时、重试和网络恢复；test/bootstrap.test.mjs 覆盖该阶段 | 保留不依赖 React 成功加载的恢复能力；不能机械地把此入口搬进尚未加载的组件 |

在 `c1f0d65` 版本临时将 app.js 置于严格 TS 审计时有 430 条诊断，其中 1 条为临时审计未复现构建中 shared 路径映射造成的模块解析问题，余项包含隐式类型、可空性、参数及契约问题。该审计位于仓库外，不是正式 typecheck 失败，也不是 430 个运行错误。正式 tsconfig 使用 strict=true，但保留的 JavaScript 为 checkJs=false，因此正式 typecheck 通过不能证明上述主控制器已经类型化。

## 后续收口顺序

1. 会话选择与详情应用已经完成专项迁移，见[报告](verification-framework-thread-selection.md)。请求回答协调也已完成专项迁移，见[报告](verification-framework-request-response.md)。工作台 init 也已完成[专项迁移](verification-framework-workspace-startup.md)。会话控制状态已完成[类型迁移](verification-framework-session-context.md)，连接配置启动读取已完成[类型迁移](verification-framework-connection-bootstrap.md)，继续完成主控制器事件装配边界，同时逐项收敛 Shell 运行属性；每次迁移对照相应旧版流程。
2. 保留原生正文算法和独立启动恢复入口，核实其稳定容器及适配契约。服务端后续重点转为真实行为和资源验收，不重复进行已经完成的路由拆分。
3. 本轮已在待处理请求为零时更新独立预览，桌面和手机模式启动检查通过。后续每次更新仍须重新检查，不得靠回答不属于本任务的请求或打断会话解除限制。
4. 在同一最终候选上收口功能、视觉、输入、滚动、断线恢复、SSH 与手机验证。`dc4bba1` 已完成[限定集成对照](verification-framework-candidate-integration.md)，后续 `ca2864a` 与 `9e7e5d9` 分别补做账号、模型专项和真实入口检查，`3e37b0b` 补做会话状态及维护流程四视口对照和真实入口检查，`8362c3d` 补做连接选择与启动失败恢复四视口对照和真实入口检查，`7eb6eb3` 补做连接摘要、维护和状态四视口对照及真实入口检查，并完成当前输入、键盘草稿和附件集成复核，以及侧聊控制、主侧同时带图发送隔离和迟到刷新复核；[当前问题回答复核](verification-framework-questions-current.md)继续补齐原生问题与异步问题四视口集成对照；[当前审批卡片复核](verification-framework-approvals-current.md)补齐决策分支、断线与等待状态；`17a7dd4` [修复排队编辑焦点](verification-framework-queue-editor-focus.md)，并在正常调试环境复验四视口编辑、迟到响应和发送路径，保留共有刷新失焦及时序差异记录；仍须在最终候选上完成全量对照，首屏复测未通过性能门槛。历史证据可作为回归依据，不能把不同基准的结果拼成一次全量通过。
5. 解决稳定性能退化并补齐资源测量，记录剩余外部限制。只有全部原计划门槛有对应证据，才能标记本轮交付完成；合并 master 和正式上线仍不在本轮范围。

审计本身不替代应用验证。应用改动与验证范围以对应专项报告为准；本页依据当前源码、回归日志、Git／构建状态及版本接口更新。
