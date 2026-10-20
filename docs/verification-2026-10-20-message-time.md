# 消息时间与回复耗时

## 来源与实现

- 参考用户提供的 Codex“用时 20分 37秒”截图。只读检查本机 ChatGPT.app 的 app.asar：`app-primary-b4ce9e46e8cf.js` 中 `localConversation.workedFor.v2` 明确用于活动与最终回复之间的耗时分隔；`collapsed-turn-disclosure-5ab38617e1bb.js` 将耗时与过程展开入口结合。未修改桌面文件或引擎。
- 原生 schema `ThreadTurnsListResponse` 的 Turn 定义确认：startedAt、completedAt 为 Unix 秒，durationMs 为毫秒。优先展示 durationMs；缺少时使用两个原生端点之差。运行中、未知或无效耗时不展示，不以网页计时替代。
- 原生 thread_history_1.sqlite 的 thread_items 有逐条 created_at_ms。既有只读历史适配器在列存在时附带 createdAtMs，仅用于用户消息展示；兼容缺少该列的旧快照。追加消息不使用轮次开始时间。原生协议的 userMessage schema 无时间字段，因此协议回退或时间尚未同步时不显示。
- 消息时间常驻气泡下方，按既有北京时间规则展示完整日期及秒。此布局按用户需求实现，未声称与桌面时间交互像素级一致。耗时每轮显示一次；保留原始消息、过程顺序和内容。无过程记录时显示静态耗时行。

## 验证

- 新增 4 项 Node 和 2 项 Python 行为测试：逐条时间、追加消息、无效和缺失数据、秒/毫秒、原生耗时优先、结束状态、过程分组和旧快照兼容。
- npm test：289 Node、55 Python 全部通过。日志 `/tmp/rcm-message-time-tests-woshts2y.log`。
- ego-browser 空间 34；4327 隔离预览，RCM_MOBILE=0、全新临时状态目录。API fixture 拦截全部请求，未发送真实任务。
- 桌面 1440×900、窄屏 390×844 无横向溢出，时间右对齐；Enter 展开/收起，Tab 焦点可见。截图 `/tmp/rcm-message-time-desktop.png`、`/tmp/rcm-message-time-mobile.png`。
- 模拟运行中无时间的实时消息不显示时间或完成耗时；中断事件使用原生事件携带的耗时；断开后已知时间保留。无浏览器 JS 异常。
- 真实只读历史抽查当前会话最近 5 轮、8 条用户消息：每条输出时间与原生 created_at_ms 一致，4 个完成轮次有原生 durationMs。预览未连接真实引擎，HTTP 读取返回 DISCONNECTED；该项不计入真实 HTTP 验证。
- 未重测实体手机、系统中文输入法或发送流程；未修改输入和执行逻辑。

## 部署状态

- 功能提交 `9013d57f0297d302181d84da5f5f5c0a1939bdb3` 已推送 origin/master，安装源码 update-source 已快进至该版本。
- 两次执行标准安装流程，均在备份前的空闲检查被其他 active 会话拦住。原生状态复核确认：当前部署会话以外仍有一条 active 会话，连接正常、待处理请求为 0。未扩大自身会话豁免，未中断任务。
- 本次尚未正式部署，未重启网页，未生成本次备份；正式版仍为 `19a8a2fad4dfb4fb1b33db042465cf34f62939b2`。待其他会话结束后重新执行标准安装。正式 HTTP 时间字段验收尚未执行。
