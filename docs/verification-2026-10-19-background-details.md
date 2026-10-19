# 已结束轮次与后台命令说明

真实原因：通知优化轮次已 completed，但原生 thread/backgroundTerminals/list 仍返回本轮验收启动的 4327 预览服务（processId 49863）。通过原执行工具的 write_stdin 向该专用会话发送 Ctrl+C 结束它，工具返回退出码 0；随后真实查询确认该进程已从原生列表移除。没有停止目标 Codex 引擎或其他用户任务。

改动：空闲但存在原生后台命令时显示“本轮已结束 · N 个后台命令仍在运行”，可用键盘展开查看原生命令及编号，解释回复结束与后台进程的区别。保留原停止入口；不会在回复完成时自动杀掉可能有用的服务。已结束轮次的过程摘要使用实时 itemId 核对，不再用旧工具 inProgress 快照断言执行中；未知读取仍显示状态未确认，原始消息和工具记录不变。

依据：复核既有 docs/verification-2026-10-19-background-indicator.md 原生状态验证记录；这次展开说明为 RCM 展示改进，未声称与桌面布局完全一致。

验证：相关 10 项测试通过；共享目录 npm test 202 Node / 47 Python 通过（含另一会话未提交的桌面发现测试）。ego-browser 空间 114 在现有 4327 预览上只读加载资源，fixture 拦截全部业务 API；原计划新建独立状态启动因端口被另一会话占用而未运行，没有停止其服务。模拟完成轮次保留后台命令、未知/空闲状态、Enter 展开、可见焦点、长命令换行；桌面与 390px 无横向溢出。截图 /tmp/rcm-background-detail-desktop.png、/tmp/rcm-background-detail-mobile.png。未测试真实模型完整生命周期和实体手机；未改输入流程，未复测中文输入法。
