# 设置反馈与布局优化

- 检查更新状态立即显示“正在检查”和等待文案，完成显示检查时间及结果，即使后台阶段未变化也有反馈。
- 提交更新立即显示不定进度条和准备状态，后台阶段展示检查、拉取、验证、部署、完成；没有虚构百分比。失败停止进度，保留原因；断线显示等待恢复。部署保护和请求语义不变。
- 连接、浏览器备份、诊断默认折叠，切换详情分类保留展开状态；标题箭头靠右，按钮允许换行；通知说明精简，浏览器备份范围按需展开。沿用既有 RCM 详情布局和已验证键盘流程，不宣称新增维护功能是 Codex 原生能力。
- 更新 worker 失败日志同时保存 stdout、stderr 和错误信息，避免 npm test 失败详情丢失。

## 验证

- npm test：275 Node、53 Python 通过，日志 /tmp/rcm-settings-tests-final.log。新增行为测试验证即时检查反馈、相同结果反馈、部署进度、失败恢复按钮。
- ego-browser 空间 26，独立 4327 预览和 API fixture。桌面、390×844 检查无横向溢出；检查慢请求、验证阶段、断线、失败、成功反馈通过；Enter 展开备份后切分类仍保持展开；Tab 检查按钮焦点 solid、Enter 检查有效。无 fixture 脚本错误。空间已关闭。
- 已查看 /tmp/rcm-settings-desktop.png、/tmp/rcm-settings-mobile.png、/tmp/rcm-settings-mobile-final.png；最终手机截图通知为紧凑横排。未修改输入流程，未复测中文输入法；未使用实体手机。
- 真实服务只读核对：用户发起 job REDACTED-ID 已在测试阶段失败，未部署。旧日志只留 Command failed: npm test，无法定位当次原因。在永久 update-source 目录使用精简 PATH 复跑该版本，274 Node、53 Python 通过；不能据此宣称已查明或修复当次测试失败。
- 网页按钮完整真实成功更新链路仍未验收，模拟反馈验证不等同真实部署。正式部署使用原安装程序，另记下方。

## 部署状态

功能提交 35a4ef4 已推送 origin/master，永久 update-source 已快进到该版本；该提交包含原正式 cd010569f4dafbe796d5fe69162a787473d92baa。标准安装在第一次空闲检查即拒绝：另一个本机会话 REDACTED-ID 仍 active。当前部署会话 ID 不同，未扩大豁免、未停止任务、未重启正式服务。此次仅代码交付和隔离预览通过，尚未正式上线。

## 重新部署完成（2026-10-20）

- 用户明确要求提交、推送并重新部署。工作目录干净，`master` 与 `origin/master` 一致。部署提交为 `cc4efe22b6ccca184d827e44308557ad639d9f49`，包含原正式版本 `cd010569f4dafbe796d5fe69162a787473d92baa`、设置反馈修复及 AGENTS.md 更新。
- 在该提交运行 `npm test`：275 项 Node.js、53 项 Python 测试通过。日志为 `/var/folders/1c/tbrgv3gn6xbc_m1_7qyptt9w0000gn/T/rcm-redeploy-tests-dmqjssgc.log`，测试数据保留，未清理。
- 永久源码目录 `~/Library/Application Support/RemoteCodexManager/update-source` 快进到同一提交。标准安装通过部署锁和两次空闲检查，仅豁免当前本机部署会话；其他连接无阻塞。未停止 Codex 桌面、原生引擎或任务。
- 部署前加密备份为 `~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。安装记录时间为 `2026-10-20T08:37:27.692Z`，仅重启 RCM 网页服务，健康检查通过。
- 正式 `/api/version` 与部署提交一致。首页、`app.js`、`styles.css`、`system-update.js`、`browser-backup.js` 的 SHA-256 与提交内容一致；`/api/system/update` 返回可用。
- 重启后本机连接恢复。机器 B 初次核对仍在连接中，后续只读核对已恢复 connected；两条连接均无待处理请求。此次未重新做浏览器视觉或实体手机验收，未通过网页更新按钮触发另一轮部署。
