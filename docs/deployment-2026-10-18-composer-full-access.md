# 网页输入修复与固定完全访问部署（2026-10-18）

已于北京时间 2026-10-18 20:03 完成正式部署。

- 原版本：`7b27d4cb8688d018100e6eeec87d370bdb69c6b1`。
- 本次版本：`c695f102883611bd3c49a45a74965cc3f275b403`，分支 `codex/composer-full-access`。
- 部署前加密备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。
- 按标准命令 `node scripts/install-local.mjs --ref c695f10` 安装已提交版本；空闲检查通过，未跳过备份或健康检查，未停止目标引擎。

## 已上线

1. 网页固定完全访问，移除输入区及新建会话权限选择，旧偏好不能覆盖。
2. 工具栏与输入框对齐，工具菜单定位及键盘焦点修复。
3. 图片使用符合现有 CSP 的数据 URL 解码，修复粘贴/选择图片失败。
4. 后台运行状态以实时列表为准，区分运行、无后台任务和状态待确认。
5. AGENTS.md、README 记录功能修复验证通过后默认提交并重新部署的规则。

基于原正式版本整理发布，仅叠加本轮变更，保留已上线的侧栏与手机登录修复。开发目录其他未提交内容未加入本次版本。

## 验证

- 发布版本 92 项 Node、24 项 Python 测试全部通过，详见 [权限验收](verification-2026-10-18-full-access.md) 和 [输入修复验收](verification-2026-10-18-composer-fix.md)。
- 正式 `/api/version` 返回本次完整提交；index.html、app.js、composer.js、composer.css、attachments.js、connection-state.js 均 HTTP 200，SHA-256 与发布工作树一致，CSP 保持原策略。
- Ego Lite 打开真实 4317 页面，确认没有模拟 API，页面不存在权限选择控件。
- 服务重启期间首次历史读取为暂未连接；自动重连后本机恢复 connected、pendingRequests=0。原会话 `REDACTED-ID` 读取 HTTP 200、idle、后台列表为空。
- LAN `https://192.0.2.1:4319` 使用配置的 CA 校验，返回 HTTP 200。
- 浏览器验收空间及本轮临时 4327 预览进程均已关闭，没有删除测试目录或证据。

本轮未做实体手机、Safari/Android 或 SSH 图片端到端测试；图片发送和固定权限请求的交互验证使用模拟 API，不宣称真实模型发送已重新验收。现有网页标签页需要刷新加载新资源。
