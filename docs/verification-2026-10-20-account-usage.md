# 顶栏账号用量

Codex 标识旁显示原生账号剩余额度，按原生窗口标注 5h、周或分钟数。悬停、键盘访问及点击可查看剩余比例和重置时间。API Key 等非 ChatGPT 登录隐藏；未知或失败不显示虚构额度。每分钟只读刷新，断开时隐藏并丢弃迟到响应，不保存账号凭据或额外业务状态。

接口依据目标引擎 0.163.0-alpha.10.2 实际生成的 JSON Schema，使用 account/read（不强刷 token）及 account/rateLimits/read；优先 codex bucket。独立 4327 预览真实只读验证返回周额度已用 94%，页面显示周 6%。未修改原生应用、数据或任务。

260 Node、53 Python 测试通过。覆盖 API Key 隐藏、窗口比例、codex bucket、断开后迟到响应。ego-browser 验证桌面展示及 390px 页面无横向溢出；本次不修改输入法流程。不声称与桌面原生用量入口像素一致，位置按用户截图。

正式部署 06d2f53ee82baaa3c38f92c725278635ac7346e4 完成，推送 origin/master。安装通过空闲检查、加密备份及健康检查，只重启 RCM 网页。部署前正式版本 20d6a8e 为该提交祖先，保留已上线功能。备份位于 `~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。390px 打开侧栏后用量位于可视区域，键盘可聚焦，无页面横向溢出。预览服务已关闭。

## 字体可读性调整

按用户反馈将用量文字从 10px 灰色调整为 13px 黑色（#000，字重 500）。ego-browser 实测计算样式与预期一致，桌面和 390px 侧栏截图检查通过、无页面横向溢出、键盘可聚焦。260 Node + 53 Python 测试通过。仅样式变化，不涉及原生接口或输入行为。

正式部署 3f7ef8a02e282b70e05b860254db7853e02d85f0，已推送 origin/master；空闲检查、备份及健康检查通过，仅重启网页。部署前备份 `~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`，保留上一正式版本全部功能。独立预览已关闭。
