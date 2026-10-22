# 清空历史连接诊断

用户要求清空当前历史异常。增加受既有 Origin / CSRF 保护的 POST /api/diagnostics/clear，按 host 清空 RCM 内存中的历史错误和历史恢复失败汇总，并广播最新状态。保留连接、运行会话、订阅及检查点；不删除原生会话，不声称已修复缺失历史。以后发生的新错误、下一次重连恢复失败仍正常记录。普通错误列表沿用最近 10 条展示，恢复失败为独立汇总。没有修改页面布局或增加按钮；旧标签页中已有的浏览器内存日志可通过刷新清除。

验证：npm test 通过，216 项 Node + 53 项 Python。新增行为测试覆盖清空不影响连接和订阅、后续错误仍记录、重新恢复失败重新显示，以及 HTTP CSRF / Origin / 连接隔离。初次 HTTP 测试受测试夹具自动恢复影响，明确关闭夹具自动恢复后全量通过。未执行浏览器 UI 验证，本次不改前端代码。

正式部署：代码提交 14f3a25 已推送 origin/master。运行既有安装脚本被空闲检查阻止：local 的另一会话 REDACTED-ID 处于 active；稍后复查仍在运行。未进入备份或重启，未绕过检查。正式版本仍为 d1a986a，当前历史诊断尚未清空。待其他会话空闲后，从届时最新且验证通过的 master 部署，再通过 CSRF 保护接口仅清空 local 诊断并核验连接及会话状态。

## 正式部署及清空完成

用户再次授权部署后，拉取 origin/master，无新增远端提交，工作目录干净。最新 master c3fc0ede4076f2388fed5bcce755575ad33d6e3a 包含当时正式版本 5dc460a 的全部功能；npm test 通过 218 项 Node + 53 项 Python，日志 /tmp/rcm-diagnostic-redeploy-tests-20261019.log。

既有安装脚本空闲检查、备份、网页服务重启及健康检查通过，正式运行 c3fc0ede4076f2388fed5bcce755575ad33d6e3a。备份为 /Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age。目标引擎 PID 始终为 1596，未重启引擎。

等待正式连接 connected 后，经 CSRF / 同源校验调用 POST /api/diagnostics/clear?host=local。真实状态接口核验：errors 从 8 变为 0，recoveryFailures 从 8 变为 0；连接仍 connected、service.running=true，订阅和控制会话 ID 列表未变化，当前会话仍 active，另一会话 idle。未操作其他连接的历史诊断。未进行浏览器或手机实机复测；旧标签页若保留客户端内存日志，需要刷新页面。清空不等于缺失原生历史已修复，未来重连时再次恢复失败仍会重新记录。
