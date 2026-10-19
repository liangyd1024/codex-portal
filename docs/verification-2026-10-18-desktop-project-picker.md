# PC 新会话项目选择优化

依据用户截图和既有 new-chat/project-picker 验收记录，PC 端复用手机选择器的数据与草稿逻辑，将原生长下拉改为 440px 宽、最大 560px 高的可搜索模态面板。短屏限制在视口内，项目列表独立滚动；桌面打开聚焦搜索，手机仍采用底部面板且不自动唤起键盘。同名项目显示路径，选择即时生效，无额外确认。

没有 Codex 原生项目选择器的直接验收证据，不宣称视觉完全一致。

## 验证

- npm test：148 项 Node、33 项 Python 通过；git diff --check 通过。
- ego-browser 空间 84，4327 全新隔离状态目录，mobile-browser fixture 拦截全部 API；51 个项目测试。
- 1440×900 桌面面板高度 560px、列表内容高度 2484px，搜索自动聚焦；1440×480 短屏面板 y=24..456，均无横向溢出。
- 390×844 手机面板 y=253..844，底部布局与独立滚动保留，无横向溢出；桌面与手机截图均目视检查。
- 搜索、同名路径、无结果、方向键+Enter 选择、Tab、Escape/遮罩取消、焦点返回、中文草稿保留、创建禁用同步关闭通过。模拟组合输入 Enter 未选择项目，所有操作未发出 POST，页面无脚本错误。
- 中文输入法仅组合事件模拟；未做实体系统候选验收，未向真实引擎发送消息。

截图保存在 /tmp/rcm-desktop-picker.png 与 /tmp/rcm-desktop-picker-mobile.png。

## 正式部署

代码提交 b6eb51d58b5fd539ed5f0e37ff8b7b1e96beb1de 已推送 origin/master，包含正式基线 263cfc4 及后续文档变更。指定版本安装通过空闲检查、部署前加密备份和健康检查。正式 /api/version 返回该提交，project-picker.js/css 与已验证源码逐字节一致。正式入口未发送测试消息。

备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T143800903567Z.tar.gz.age`。
