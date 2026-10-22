# 应用连接器静默加载验收

## 范围

按用户确认，仅调整网页反馈。`codex_apps` 的 starting、failed、ready、cancelled 不再生成会话顶部提示；failed 原始错误由 Manager 放入有界连接诊断，包含会话 ID，并标记 diagnosticOnly，不触发 toast 或任务通知。其他扩展及真实工具调用错误保持原有路径。

没有修改桌面引擎、全局 Codex 配置或工具初始化时机，没有新增服务。此改动不是网络超时修复，也不声称实现了按需联网或延迟加载。

## 验证

- Node 测试 187 项、Python 测试 45 项全部通过。新增回归覆盖静默状态、诊断保留、运行状态不变、真实工具失败事件完整转发；其他扩展提示仍按会话隔离。
- 独立预览使用端口 4327、RCM_MOBILE=0、独立状态目录 `/tmp/rcm-silent-startup-preview-20261019-1533`。
- ego-browser 使用真实页面代码和模拟 API/SSE。桌面与 390px 窄屏均无启动横幅、无横向溢出；诊断保留原始超时和会话标识，草稿保留、发送按钮可用。诊断 summary 的 Enter 展开/收起与焦点已检查。
- 早期浏览器 fixture 缺少 sidebar 字段产生的刷新错误已补齐测试数据后重验，不属于产品改动。
- 本轮未重新发起真实连接器业务调用。浏览器事件验证属于模拟验证，不作为真实网络恢复证据。输入流程未修改，未重测系统中文输入法候选窗。
- 截图：`/tmp/rcm-silent-startup-desktop.png`、`/tmp/rcm-silent-startup-mobile.png`。

## 部署

部署前正式版本为 `0fafc97ab2829d8570a8cac06a32b01fb51466a2`；当前 master 在其上仅增加协作约定和验收/研究文档，已核对保留正式功能。

已通过 `node scripts/install-local.mjs --ref 28f9e23` 完成部署，空闲检查、加密备份、网页服务重启和健康检查均成功。正式 `/api/version` 返回 `28f9e23f6fbb1a61a8120ef4ef099074e6c9155e`，正式静态模块已包含静默加载逻辑。

部署前备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。没有停止或重启目标 Codex 引擎。验收结束后已停止本次 4327 预览进程，关闭测试浏览器空间；保留测试截图和记录。
