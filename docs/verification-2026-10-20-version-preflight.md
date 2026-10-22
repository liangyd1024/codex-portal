# 版本比较与部署状态复核

## 调研与行为

- 旧更新和安装流程读取每个已配置连接的 /api/status 内存快照。这些 GET 不会发起连接；Manager 会按既有连接意图恢复订阅或在断线后重连。因此 machine-b 提示是现有连接恢复检查，不是部署命令要求重新连接 machine-b。
- 截图 ID 是当前对话。只读原生 thread/read 核对时，该会话确实 active，其他本机 controlled 会话均 idle。lastTurnStatus=completed 是上一轮结果，不能覆盖当前 active；未能追溯截图瞬间的原生状态，不能断言当时必然缓存错误。
- 部署前新增本机只读接口，通过已经连通的 RPC 获取受控会话原生状态。不得 connect/resume；连接代际或状态 revision 变化时拒绝旧快照。未连接目标保留其连接状态供检查，不主动建连。与旧版部署的过渡采用旧只读状态接口回退。
- 手动安装与网页更新共用复核，最多 4 次、间隔 2 秒，覆盖短暂收尾；没有固定必须等若干秒的规则。真实运行、未知状态、待处理请求和连接中仍保护。仅保留本机当前 Codex 部署会话的 active 豁免；网页操作没有会话豁免。提示优先显示会话及连接名称。
- fetch origin/master 后比较目标和正式版本。相同则直接完成，不执行测试、空闲检查、备份、安装或重启。源码、master、origin、快进和线上基线保护保留。
- 页面展示当前版本、最近拉取的最新版本、该次更新前版本。无新版本时显示“已是最新版本”，隐藏阶段和刷新页面按钮。沿用既有 RCM 维护交互，不宣称为 Codex 原生任务功能。

## 验证

- npm test：281 Node、53 Python 通过，日志 /tmp/rcm-fresh-version-final-tests.log。
- 新增回归：缓存 active 但原生 idle、上一轮 completed 但原生 active、并发状态变化拒绝旧读、断开/重连时不发 RPC、短暂收尾重试、API 返回原生快照、未知自身状态不可豁免、同版本跳过部署及阻塞检查、无更新时隐藏刷新按钮。
- ego-browser 空间 29，独立 4327 预览及 API fixture。桌面/390px 三组版本、更新完成与同版本分支、单次 Enter 提交、Tab solid 焦点、无横向溢出与脚本错误通过。截图 /tmp/rcm-version-desktop.png、/tmp/rcm-version-mobile.png 已查看。未改输入流程，未复测中文输入法或实体手机。
- 真实旧服务原生只读核对完成；新版本完整更新重启分支仍未通过网页按钮端到端验收。标准安装及真实同版本验证结果另记下方。

## 正式部署与同版本实测

功能提交 2d4380a07dc137b7424452452814996ea2185e5e 已推送并通过标准安装上线。加密备份 backups/MACHINE-TIMESTAMP.tar.gz.age，健康检查通过；保留现有功能和当前会话精确豁免，未停止目标服务或任务。

正式 POST /api/system/update 实际启动 job REDACTED-ID，fetch 后 current/from/target 均为该提交；约 7.8 秒返回 succeeded、unchanged=true，“已是最新版本，无需重新部署”。前后网页 instanceId 相同，确认未重启。此时当前对话仍在运行，同版本分支无需执行空闲检查。证据 /tmp/rcm-version-noop-evidence.json。正式新原生状态接口成功返回当前本地受控会话名称和状态；未连接新的远程目标。浏览器正式 p2 只读检查三组版本及无更新文案通过，空间 29 已关闭。
