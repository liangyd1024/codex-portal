# 手机通知入口修复

用户截图显示 iPhone 普通浏览器标签页，Notification API 不可用导致开关禁用。平台依据：https://webkit.org/blog/13878/ 。iOS 16.4+ 系统通知要求从主屏幕 Web App 打开；不能通过解除 disabled 绕过。

新增主屏幕 manifest、iOS meta 和携带配对 Cookie 的 manifest 请求；静态资源继续受原有认证保护。iOS 普通标签页提示具体安装步骤，安全上下文与不支持状态分别说明。iOS/Android 使用 Service Worker showNotification；桌面保留原有 Notification 构造及 onshow 确认。权限请求仍直接来自点击，初始化中禁止重复操作，异常可重试。Worker 不拦截请求、不缓存业务数据、不执行任务、不注册后台推送；仅展示收到的原生事件通知。API 接收只报告已提交系统，不伪称真实横幅显示。页面关闭/暂停后仍依赖恢复连接补发。

原生流程参考 docs/verification-2026-10-19-notification-delivery.md；手机平台差异明确呈现，未声称支持原生后台推送。

验证：npm test 220 Node、53 Python 全通过（/tmp/rcm-ios-notifications-final-tests.log），git diff --check 通过。新增 iPhone/iPad 主屏幕、HTTPS、不支持、桌面兼容以及 worker 失败重试与成功去重测试。ego-browser 空间 120，独立 4327 预览与 API fixture，真实 Chromium worker 注册/激活成功；iOS UA、主屏幕状态、权限批准与 showNotification 为模拟。键盘 Space 开启、Enter 测试发送、焦点 solid 可见、无脚本错误；桌面和 390px 无横向溢出，已查看截图 /tmp/rcm-ios-notifications-desktop.png 和 /tmp/rcm-ios-notifications-mobile.png。未改输入流程，未复测中文输入法。真机权限与横幅、锁屏、通知点击恢复未实测，需手机验收。浏览器空间已关闭。

部署基线 3073bf0619a7153372e5a3383bdd3560a6e665a5 为当前 master 祖先，保留已上线功能。部署结果待执行标准安装后记录。

正式部署：5b8984391ba59b54d9843682e668cfa35af4b9b2 已推送 origin/master，标准安装完成两次空闲检查、备份与健康检查，仅豁免当前部署会话。备份 /Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age。4317 /api/version 已核对；manifest 返回 200 和 application/manifest+json，notification-platform.js 为新代码。只重启 RCM 网页服务。独立预览进程 24270 已发送 TERM 关闭。
