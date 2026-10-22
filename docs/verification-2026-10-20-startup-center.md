# 中央启动恢复入口与点击反馈

## 调研和修改

原独立 bootstrap 的顶部链接直接调用 location.reload，既没有改变按钮状态，也没有检查失败后的可恢复状态。历史依据：`verification-2026-10-19-phone-startup.md`；入口原本为主模块无法加载、连接配置请求失败提供恢复，并非手机主屏幕模式要求放在顶层。

恢复面板迁入主内容区中央，采用现有欢迎页图标和主按钮层级。启动未就绪时隐藏正常欢迎/消息内容，rcm-ready 后移除启动状态并隐藏面板。bootstrap 仍独立于 app.js 模块图，不依赖主程序已成功初始化。

点击立即显示“正在重新加载…”并禁用重复提交，先通过只读连接配置请求核对服务可达性，12 秒超时或连接错误时保留当前页、显示原因并恢复重试。可达后重载页面；导航本身超过 15 秒也允许再次重试。迟到 ready 取消待处理重试，防止已可操作页面的草稿被重载覆盖。普通 pageshow 不自动重试刚发生的失败，仅 BFCache 恢复、网络恢复和返回前台保留原自动恢复语义。未修改认证、CSRF、配对或原生引擎。

## 验证

- 全量 npm test：267 Node、53 Python 全通过，日志 `/tmp/rcm-center-startup-tests.log`。覆盖立即反馈、重复点击、网络失败、请求超时、导航卡住、迟到就绪不重载及 pageshow 区分。
- ego-browser 空间 23；4327 隔离预览，RCM_MOBILE=0，独立 `/tmp/rcm-startup-center-20261020`。仅拦截 `/api/connections` 模拟失败/挂起，没有执行真实会话写入。
- 桌面与 390×844：恢复入口位于主内容区中央，无顶部失败横幅，无横向溢出。窄屏按钮 160×47px、x=115；Enter 触发后立即显示加载文案和 disabled，焦点 outline=solid；12 秒后显示连接超时、按钮重新可用。
- 解除模拟故障后点击重试，真实预览页面成功重载，startup-status hidden=true、startup-pending 已移除、正常连接页面可见。
- 截图 `/tmp/rcm-center-startup-desktop.png`、`/tmp/rcm-center-startup-mobile-pending.png`、`/tmp/rcm-center-startup-mobile.png`。已查看桌面和窄屏加载态截图。
- 未修改输入流程，未重复原生中文输入法验证。未做 iPhone 添加主屏幕真机验收，不能将窄屏模拟描述为 iOS 真机通过。

## 正式部署

部署前基线为 16d096f096172b9edb181dbe2eaff21866cc5114，当前 master 包含它。正式部署版本 `694f0027c61d28aab8c54b8d9b337c711555fa98` 已提交并推送 origin/master。标准安装完成空闲检查、加密备份和版本健康检查，仅豁免当前部署会话，未停止原生引擎或任务。备份：`~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。正式浏览器页核对版本一致、恢复面板位于 main 且正常启动后隐藏，新建入口恢复可用；空间 23 已关闭。
