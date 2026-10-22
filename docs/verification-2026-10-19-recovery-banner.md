# 手机返回页面时的恢复提示优化

## 真实诊断

2026-10-19 正式 4317 状态接口：连接正常，connectedAt 为 06:01:26 UTC（北京时间 14:01:26）。8 个 recoveryFailures 均为 `no rollout found for thread id ...`，错误时间集中在同一次恢复连接。证明横幅反映历史恢复失败；不证明每次返回手机浏览器都发生引擎重连。未删除订阅或历史文件，未尝试接管用户工作中的会话。引擎缺少这些历史记录的更早原因未确认。

## 改动

历史失败汇总与每个会话原始错误保留在设置中的连接诊断；全局横幅仅提示当前选中的受影响会话，新会话与正常会话不显示无关警告。切换会话及时更新提示；恢复成功消除对应提示。真实断线、协议受限、连接错误提示保持原有优先级。返回前台同步逻辑未改动。

查阅已有 Codex 交互验证记录 docs/new-chat-verification-2026-10-18.md 和 docs/verification-2026-10-18-thread-sync-production.md；没有 Codex 原生对应恢复横幅证据，不声明像素或文案完全一致。

## 验证

- 恢复与同步相关 15 项 Node 测试通过，包含失败隔离、取消、前后台、断网恢复、迟到响应与草稿场景。
- npm test 重跑：173 Node + 38 Python 通过。首次 Node runner 出现 cloned data 反序列化异常，重跑未复现。
- ego-browser TaskSpace 99，隔离预览 4327，模拟 API / SSE：正常会话无横幅、受影响会话提示缺失历史、诊断保留错误、恢复成功撤销提示、模拟 SSE 断开与恢复、focus 同步、中文文本草稿保留、无写请求、Tab 焦点到 SUMMARY 均通过。
- 桌面截图 /tmp/rcm-recovery-desktop.png，390×844 截图 /tmp/rcm-recovery-mobile.png，已查看；390px scrollWidth=390，无横向溢出。
- 未修改输入处理，未进行 iPhone Chrome 真机切 App 或真实中文输入法候选确认测试。没有将模拟断线当作真实服务断线验收。
- 共享 master 出现另一聊天文件预览功能的未提交修改，本次仅暂存自己的差异。

## 正式部署

修复提交 `ab0b3ed` 已推送 origin/master，包含当前正式版本 `6c71e92` 的全部改动。为保留另一聊天的未提交文件预览功能，在 `/tmp/rcm-recovery-release-20261019-1426` 创建 master 的干净本地副本；该提交再次运行 npm test，首次复现 Node runner 通信异常，重跑全部通过（日志 `/tmp/rcm-recovery-release-tests-retry.log`）。

执行 `node scripts/install-local.mjs --ref ab0b3ed` 被空闲检查拒绝：正式入口仍有 1 个 active 会话。未进入备份、重启或健康检查阶段；正式版本未改变。再次核对仍有运行任务，未绕过检查或停止任务。需空闲后从最新且已验证的 master 继续安装，不能把本次预览描述为上线。浏览器复测 TaskSpace 已关闭，隔离预览服务已停止。

## 重新部署完成（2026-10-19 14:50 北京时间）

用户要求重新部署后，确认 local / machine-b 均无活动任务和待处理请求，工作目录干净，拉取 origin/master 无新增提交。正式原版本 db88b2d，最新 master 0fafc97 包含该版本及 ab0b3ed 恢复提示修复。部署前 npm test 全部通过：186 Node + 45 Python，日志 `/tmp/rcm-redeploy-tests-20261019.log`。

执行现有安装脚本成功安装 `0fafc97ab2829d8570a8cac06a32b01fb51466a2`，部署前加密备份 `/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。脚本健康检查通过，随后真实 `/api/version` 返回目标提交，`/api/status` 显示 connected、service.running=true；正式 recovery-state.js 已为修复版。8 条缺失历史记录的恢复错误仍保留，未删除或声称修复其历史数据。手机浏览器刷新一次加载新版后，正常会话不再显示这些无关恢复失败的全局横幅。本轮未追加 iPhone Chrome 真机验证。
