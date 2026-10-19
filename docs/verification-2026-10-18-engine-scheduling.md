# 创建缓慢：专用引擎的后台调度限制

## 可重复证据

- 正式网页版本 753867c；用户仍遇到创建结果未知。前轮只修复预检与恢复语义，没有消除耗时根因。
- 当前专用引擎 launchd plist 的 ProcessType 为 Background，PID 26281 已运行约 11 小时。macOS `launchd.plist(5)` 明确指出该类别会限制 CPU 和 I/O；Interactive 用于需要及时响应的用户交互服务。
- 同一现有引擎：直接 Unix socket 的 thread/start 27439ms，经输出 relay 33431ms，排除仅由浏览器或 relay 引起。参数包括同一 cwd、gpt-6.1-sol、medium、serviceName、ephemeral=true；没有发送任务消息。
- 新 stdio 引擎按同样参数测试：代理环境 152ms，移除代理变量 178ms。不能据此把此次延迟归因于代理差异；doctor 的环境检查会显示 shell 环境，两种运行方式均报告 HTTP / WebSocket 可达，不能冒充现有 launchd 进程的网络检查。
- 关键控制实验 `/tmp/rcm-routing-scheduling-probe.py`：新进程、同样参数和环境，普通调度 thread/start 139ms；通过 `taskpolicy -c background -b` 强制后台调度为 21039ms，约 151 倍差异。这复现了后台 QoS 限制下的创建延迟。
- 临时对原 PID 执行 taskpolicy -B 未解决（直接 21387ms、relay 30645ms），已恢复 -b。`taskpolicy -B` 仅移出 PRIO_DARWIN_BG，不能完整撤销启动时的 QoS clamp。没有重启、停止或发送消息给用户会话。
- 所有测试引擎均仅创建临时会话；测试进程结束后逐个终止自己的进程，脚本和日志保留。另有前期命名的专用空白测试会话保留。

## 修改与验证

- scripts/remote-service.py：专用引擎启动类别改为 Interactive。保持运行中的服务不被自动重启，不修改 Codex 全局配置、网络验证或用户会话。
- README 补充旧服务升级需要维护停止、恢复、重新连接的说明。
- npm test：160 项 Node、36 项 Python 通过，日志 `/tmp/rcm-interactive-service-tests.log`；git diff --check 通过。无 UI 布局/输入变更，未做浏览器布局或真机测试。
- 发布前只读检查：正式入口 active=0、pendingRequests=0；check-idle 检查 2 个已加载会话、目标、后台终端和队列，返回 idle=true。这不能证明其他入口已断开，不能替代维护确认。

## 生效边界

网页更新只安装新的启动脚本，现有引擎保持原进程和启动类别。按照 README“停止目标服务”流程，需要用户确认其他入口已断开后，重新核对空闲、停止专用引擎、解除维护并重新连接，最后验证实际 launchd ProcessType 和正式新建耗时。尚未完成该生产引擎切换，不能将隔离实验速度描述为正式速度。

### 网页发布结果

启动脚本已随 `ec67106dd8ea5d0d11e6a5a42c36cc4c024c1ae9` 安装到正式网页，版本健康检查通过。部署前备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T153735163355Z.tar.gz.age`。此次仅重启网页，未停止专用引擎；待用户按维护规则确认后应用新调度类别并验收。

## 2026-10-19 正式引擎维护与验收

用户明确确认其他入口已断开，授权重启专用引擎。首次空闲检查发现旧会话仍 active 且存在后台命令，因此未停止。随后只读核实该会话已 idle、后台命令与队列为空，重新执行 check-idle 返回 idle=true（1 个已加载会话）。通过正式维护接口 release（含 allEntrancesDisconnected=true）再次校验并停止成功，执行 restore-apply.py resume 归档维护标记，再通过正式 connect 接口恢复连接。

- 正式网页版本仍为 ec67106dd8ea5d0d11e6a5a42c36cc4c024c1ae9；原有部署前备份见上节，本轮只进行引擎维护，无新代码部署。
- 新引擎 PID 1596，启动时间 2026-10-19 11:58:56 +08:00，连接恢复于 11:58:58；plist ProcessType=Interactive，launchctl 实际 spawn type=interactive (4)，运行正常。
- 正式 HTTP 新建接口连续 3 次：163ms、199ms、266ms，均 HTTP 201，无路由超时或创建结果未知错误。参数为仓库 cwd、gpt-6.1-sol、medium、full；未将额外命名请求计入创建耗时。
- 测试会话分别为 01a15253-dd7e-70b0-979f-64df7c9125b5、01a15253-de2c-7132-bc95-eabc65d6d897、01a15253-deff-7602-977c-31a8eb4ec603。随后逐个通过正式详情接口读取：160ms、80ms、69ms，均 HTTP 200，无空 rollout 错误。
- 这些是真实正式服务空白会话验证，没有发送模型任务消息；没有重新进行浏览器点击、手机真机或模型首字耗时测试，不能将接口耗时当作手机网络端到端耗时。
- 恢复状态保留既有归档/缺失会话的历史订阅错误，以及维护窗口内的连接错误记录；这些与上述新建请求不同，未擅自删除历史状态。
- 本轮仅追加验收文档，无代码变更，无需重新运行应用测试或部署网页。

此前“尚未完成生产引擎切换”的边界由本节实际维护结果更新：交互式调度现已在正式专用引擎生效。
