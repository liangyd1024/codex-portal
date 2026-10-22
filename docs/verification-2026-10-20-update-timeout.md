# 更新测试超时与自动检查

## 原因与修复

真实 web-update.log 记录 275 项 Node 测试中 1 项失败：test/mobile.test.mjs 的 macOS 手机 TLS 测试在生成 RSA 3072 CA 时被 setup-mobile.mjs 的 10 秒子进程超时终止。整套 Node 测试耗时约 90 秒。原更新 launchd job 使用 Background；本机 man launchd.plist 明确说明此类别限制后台资源，且用于非用户直接请求的工作。

- 用户主动更新改为 Standard，保留独立 launchd job、部署锁、全部测试与空闲保护，不跳过失败项。
- CA 生成允许 30 秒；设置脚本的外层调用与集成测试允许 90 秒，浏览器配置请求允许 120 秒。其他子命令保留 10 秒限制。超时错误明确指出命令与期限，不再只展示 OpenSSL 的正常进度输出。
- 删除独立检查按钮和时间提示，进入页面、联网恢复和更新期间自动查询状态。更新按钮原有源码、运行状态和测试检查保留。历史失败明确显示“上次更新未完成”，不再误导为查询失败。查询暂时失败自动重试，不重复提交部署。

## 验证

- 相关 13 项测试通过。真实 launchd Standard 临时测试 job 执行 npm test：275 Node、53 Python 全过，Node 用时约 2.84 秒，退出码 0。日志 /tmp/rcm-update-launchd-test.log。未执行真实更新或停止目标服务。
- 最终 npm test 再次通过 275 Node、53 Python，日志 /tmp/rcm-auto-update-final-tests.log。
- ego-browser 空间 27，4327 独立预览及 API fixture。桌面及 390px 无横向溢出，单一更新入口、Tab 焦点 solid、Enter 提交仅 1 次、自动阶段轮询、断线恢复成功通过。截图 /tmp/rcm-auto-update-desktop.png 与 /tmp/rcm-auto-update-mobile.png 已查看。
- 未修改输入流程，未复测中文输入法或实体手机。真实按钮完整部署链路未验收；后台测试与模拟 UI 验证分开记录。

## 正式部署

9e11b043f6be10a51462836eeb13d950646cdd8c 已推送并从永久 update-source 按标准安装流程部署。原正式 cc4efe22b6ccca184d827e44308557ad639d9f49 包含在新 master 中。空闲检查仅精确豁免当前会话，其他会话空闲；未停止目标引擎或任务。部署前备份为 backups/MACHINE-TIMESTAMP.tar.gz.age。健康检查通过，正式 /api/version 返回目标提交，正式静态模块已无独立检查按钮。临时 launchd 验证 job 和 ego-browser 空间已关闭。
