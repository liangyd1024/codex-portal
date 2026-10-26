# 部署不再强制依赖浏览器工具

日期：2026-10-26。用户明确要求移除 Ego Lite 安装限制。本记录替代此前安装记录中的浏览器强制前置。

默认 doctor、初始化和部署不要求 Ego Lite。部署检查使用 Node 读取版本、首页和发布目录中的 JavaScript／CSS，校验 HTTP 状态、资源类型及完整字节摘要。最多并发 4 个请求，只做 GET；失败仍执行原网页回退。

显式配置 RCM_EGO_BROWSER 时继续使用真实浏览器增强验收，失败不静默忽略。默认 HTTP 检查不执行前端 JavaScript，不代替 UI 或原生能力验收。没有修改配对、Origin／CSRF 或 SSH 主机校验。

实机准备发现 Codex 附带 Node 可能没有 npm。bootstrap 现在同时检查同一 Node 安装目录的 npm，缺少时准备独立 Node，不修改 Codex 自带运行时。Intel macOS 13 的本次验证使用官方 Node 独立发行包及 SHA-256 校验，包与依赖均在 Git 外。

验证：936 项 Node 测试通过。新增真实 HTTP 测试覆盖无浏览器运行、版本不符、资源缺失、错误 MIME、字节不一致及 GET-only。79 项 Python 结果和两台机器部署状态在最终验收后补记。

目标机使用 Git bundle 克隆到用户 Downloads 目录，摘要与源包一致。目标机已有旧版 RCM，因此属于独立克隆及已有用户升级验收，不是空白 Mac 验收。GitHub SSH 凭据尚未配置，不把 bundle 克隆写成 GitHub 直接克隆成功。

依赖下载检查发现锁文件使用维护者内部镜像。已将全部 resolved 地址改为公共 npm registry，保留版本与 integrity；项目级 .npmrc 和正式产物安装命令固定公共源。目标用户的全局 npm 配置不修改。远端原 master 的并发 CSRF 优化及验收文档已按 master 合并保留。
