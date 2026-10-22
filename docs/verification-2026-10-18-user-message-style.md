# 用户消息气泡样式

- 参考用户提供的 Codex 黑底白字截图；仅修改 `public/styles.css` 的 `.user-bubble` 最终样式。
- 黑色背景、白色文字、系统无衬线字体、500 字重、18px 圆角及 12px/16px 内边距。字号沿用既有桌面与手机响应式设置。截图不足以确定原生字体精确参数，此处为视觉匹配。
- 基线为正式版 `12bcbaa`，包含分区稳定性修复、输入框对齐及新建草稿改动，未回退其他代码。
- 独立 4327 预览（RCM_MOBILE=0、独立状态目录），ego-browser 注入 fixture 拦截所有 API；未发送真实消息或操作现有会话。
- 桌面 1280px、窄屏 390px：计算样式为黑底白字、500 字重，无页面横向溢出，换行正常；Tab 焦点可见。截图 `user-message-desktop.png`、`user-message-mobile.png`。
- `npm test`：103 项 Node、24 项 Python 通过。未改变异步及输入处理逻辑，未新增真实手机/中文输入法测试。

正式发布 `2ed04c8b54b12bf0d31596b80f128b27ae79c911`：空闲检查、备份、健康检查通过；正式 `/styles.css` 与已验收源码逐字节一致。备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。真实会话未执行发送验收。
