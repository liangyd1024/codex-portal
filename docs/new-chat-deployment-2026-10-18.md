# 新会话流程部署记录

- 发布提交：70983d69c77e3adde9b476830d2366fa89f1aee4。
- 通过既有 install-local 指定版本安装流程完成空闲检查、加密备份、网页重启和健康检查。
- 备份：`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。
- `/api/version` 返回发布提交；线上 app.js、index.html、new-chat.js、new-chat.css、composer.js、attachments.js 与 release 源码逐字节一致。
- 部署后 ego-browser 原验收空间 63 返回 task space not found，因此未进行生产浏览器复查，也未创建新空间绕过；真实引擎新建和发送未验收。
- 预览模拟验证与官方参考见 [验收记录](new-chat-verification-2026-10-18.md)。
- 修改已通过 git apply --check 后同步到原开发目录，保留其既有未提交改动。线上核对基准为独立发布 worktree。

- 最后状态检查：连接 connected，阶段 已连接，error=None；网页健康通过不等于引擎连接恢复完成。
