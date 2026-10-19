# 手机输入修复发布状态（2026-10-18）

代码提交：`80a3adc`（codex/deploy-mobile-ui）。

已运行 `node scripts/install-local.mjs --ref 80a3adc`，安装在部署前空闲检查阶段停止：本机入口中“用户问候与友好交流”（`01a14e0b-13c8-7992-b221-99d2ad802915`）仍处于 active/waitingOnApproval，有一条 `item/commandExecution/requestApproval`（id 11），命令为执行 npm test。

此次安装尚未生成新备份、未重启服务、未改写正式版本。正式 `/api/version` 仍返回 `ab2ffc27070f378d1f30bdbfb7f4bbda6f5e617d`。需先处理原会话审批并等待空闲，再以同一提交重试标准安装；不能跳过检查。

验收内容见 [专项验收记录](verification-2026-10-18-mobile-input.md)。

## 后续发布完成

用户自行处理审批后，本机入口状态为 idle、pendingRequests 为空。再次执行标准安装成功，正式版本为 `80a3adcde5a1a72328cdc166bdfbf35598ba4975`。

部署前加密备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T105635728755Z.tar.gz.age`。

本机 `/api/version` 与安装记录一致；首页、attachments.js、composer.js、composer.css 均 HTTP 200，首页不含 voice-toggle。仅重启网页服务，未停止目标引擎。

本机访问原 Tailscale HTTPS 地址时 TLS 握手失败（curl SSL_ERROR_SYSCALL），不能据此确认手机端访问失败，也不能将该入口标记验证通过。实体手机仍需刷新复验。

局域网入口 `https://192.168.1.14:4319/` 使用配置的 CA 校验证书后返回 HTTP 200。
