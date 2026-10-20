# 运行中附件与侧栏运行汇总

## 原因与修改

- composer 将 active 与不可输入状态混在一起，导致整个 ＋ 菜单不可打开；attachments 与原生 turn/steer 原本支持图片。本次只开放运行中的菜单和图片按钮，计划、目标、技能、插件仍按原限制禁用。发送中和连接不可用时保持禁用。
- 只读查询正式 /api/sidebar，发现额外桌面图标来自折叠的「日常」项目中「规划每日爆款新闻选题流程」，原生桌面 IPC 返回 fresh running；并非同一会话重复计数。分区与项目现在显示一个运行数量徽标，悬停及无障碍名称保留网页/桌面数量；会话行仍显示原运行来源。未修改引擎状态、未终止任何任务。
- 交互依据：用户截图、既有 composer 和 sidebar-running 验收记录、已有原生 turn/steer 图片回归测试。数量汇总属于本次改善，不宣称 Codex 原生界面具有相同样式。

## 验证

- npm test：236 Node + 53 Python 通过。混合来源只有一个汇总徽标、分区归属、断连、结束和过期已覆盖；原生 RPC 模拟验证图片到达 turn/start 和 turn/steer。
- ego-browser TaskSpace 2，4327、RCM_MOBILE=0、独立 /tmp/rcm-fix-active-20261020-own 状态。使用完整真实前端和 test/fixtures/mobile-browser.js 模拟 API，所有请求被夹具拦截，不操作既有会话。
- 运行中 ＋ 打开、真实 Chromium 文件选择、图片压缩预览、模拟 steer 失败保留文字图片、重试成功清除附件通过；未产生浏览器脚本错误。
- 1440px / 390px 无横向溢出；方向键聚焦图片、Escape 关闭并恢复焦点；合成中文 composition + Enter/229 未发送。
- 网页/桌面混合运行显示单个数字 2，项目折叠后保留数字与键盘焦点，断连清除计数。
- 截图 /tmp/rcm-running-input-390.png、/tmp/rcm-running-input-desktop.png、/tmp/rcm-running-sidebar-390.png。
- 未验证 iPhone 真机文件选择或真实中文候选窗，未向真实原生会话发送图片；真实服务只读核实运行来源。

## 部署

正式基线 66cc8db 已在当前 master，包含上一会话计划/目标菜单修改 b7b58d9 及记录 593099d。本次从合并全部修改的 master 部署，结果后补。

正式部署成功：5e727102e2f486102fbfae6273376d1b67b7d5fa，标准安装器通过两次空闲检查、当前会话精确豁免、加密备份、网页重启及版本健康检查。/api/version 独立回读一致。备份：/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261020T001143108557Z.tar.gz.age。未重启原生引擎或停止任务。
