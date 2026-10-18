# 手机输入修复发布状态（2026-10-18）

代码提交：`80a3adc`（codex/deploy-mobile-ui）。

已运行 `node scripts/install-local.mjs --ref 80a3adc`，安装在部署前空闲检查阶段停止：本机入口中“用户问候与友好交流”（`01a14e0b-13c8-7992-b221-99d2ad802915`）仍处于 active/waitingOnApproval，有一条 `item/commandExecution/requestApproval`（id 11），命令为执行 npm test。

此次安装尚未生成新备份、未重启服务、未改写正式版本。正式 `/api/version` 仍返回 `ab2ffc27070f378d1f30bdbfb7f4bbda6f5e617d`。需先处理原会话审批并等待空闲，再以同一提交重试标准安装；不能跳过检查。

验收内容见 [专项验收记录](verification-2026-10-18-mobile-input.md)。
