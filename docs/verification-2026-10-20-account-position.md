# 登录身份位置调整

- 将登录身份从左侧 Codex 标识上方移到右侧“工作区详情”标题旁。保留现有身份读取与额度入口。依据现有账号核验记录及本次用户指定位置调整，不声称与原生布局像素一致。
- 长邮箱最多显示两行，完整内容保留在 title 和 aria-label；沿用现有加载、失败、断开清空和迟到响应保护。
- 相关账号测试 7 项通过。最终 npm test：291 项 Node、55 项 Python 通过。日志：`/tmp/rcm-account-position-tests.log`。
- ego-browser 空间 39：真实 4327 独立预览成功读取账号；桌面与 390px 窄屏均无横向溢出。键盘 Tab 焦点有实线轮廓，Escape 收起详情并恢复入口焦点。
- 长邮箱与 API Key 使用 DOM 展示模拟，未切换真实登录。异步身份行为由既有单元测试验证。未改输入流程，未复测中文输入法、实体手机。
- 已查看桌面、窄屏长邮箱和 API Key 截图。最终窄屏截图：`/tmp/rcm-account-position-mobile-final.png`。浏览器空间已关闭。
- 原 Git SSH 代理连续超时；使用同一部署密钥、严格主机验证直接连接 GitHub，成功拉取最新 master。未修改持久 Git 配置。

## 正式部署

- 功能提交 `1f629fac28838929a7169e93f7737af46deeb3f5` 已推送 origin/master，包含此前正式版本 `8399014e6cdccc32436576cb5ae08aa1c2d6d59a`。
- 永久 update-source 快进后通过标准安装流程完成部署；两次空闲检查、加密备份及健康检查通过，仅豁免当前本机部署会话。只重启 RCM 网页服务。
- 备份：`~/Library/Application Support/RemoteCodexManager/backups/marco-20261020T153205438994Z.tar.gz.age`。
- 正式版本接口与功能提交一致，正式首页及 styles.css 的 SHA-256 与源码一致。独立预览已停止。
