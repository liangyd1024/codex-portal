# 右侧系统更新入口

## 实现与边界

- 右侧“工作区详情 → 设置 → 系统更新”增加“更新并重新部署”。沿用现有详情分类、按钮、状态区及键盘焦点；这是 RCM 网页维护功能，不宣称为 Codex 原生任务能力。
- 更新当前网页所在机器的 RCM 服务，不随所选 SSH 连接变化。已配对手机通过原认证、Origin 和 CSRF 检查使用同一接口。浏览器不能传入仓库、命令、版本或会话 ID。
- 安装时记录源码目录、origin 地址。更新核对工作树干净、master、origin 未变化及运行状态；fetch origin/master 后确认包含当前正式版本，再快进到目标提交，运行 npm test，并核对测试期间源码和正式版本未变化。
- 独立 launchd 更新 job 调用原安装流程。job 无 KeepAlive，异常重启不重放已开始的工作。保留空闲检查、加密备份、指定提交安装、网页健康检查和失败回退。不得停止桌面、原生引擎或任务。
- 网页操作不使用 CODEX_THREAD_ID 豁免。手动 Codex 部署保留原有当前会话精确豁免。两种入口共用部署锁；异常遗留锁不自动抢占，不自动停止任何进程。
- 更新状态保存在 RCM supportDir/web-update.json，详细输出在 logs/web-update.log。网页断线后轮询恢复结果，不重复提交。更新成功提供保存草稿后刷新页面的按钮，不自动刷新编辑中的页面。
- Git 使用既有认证、代理及严格 SSH 主机校验。脏目录、分叉、未推送本地提交、缺少线上基线、测试失败、活动会话会停止部署。预览不支持更新正式服务。

## 验证

- 相关行为测试覆盖安全接口、CSRF/Origin、禁止执行参数、流程顺序、上述拒绝条件、共享锁、委派安装器不能释放父锁、异常锁不抢占、已完成但仍收尾的 worker 不被杀死。
- 全量 npm test 最终 274 Node、53 Python 通过，日志 `/tmp/rcm-system-update-tests-final.log`。前一次全量遇到 Node 测试运行器序列化错误（mobile-session 文件），单独复跑该文件 3 项通过，随后完整重跑通过；未修改测试来忽略错误。
- ego-browser 空间 25，4327 预览，RCM_MOBILE=0，独立 `/tmp/rcm-system-update-20261020`。API fixture 模拟更新，不对业务会话写入或真实重启。
- 桌面验证提交只发一次、进行中禁用、模拟重启断线显示等待并自动恢复成功；失败恢复重试。390×844 无横向溢出、主按钮高 44px、Enter 提交有效，Tab 焦点 solid，Escape 关闭详情并恢复焦点到入口。无脚本错误。
- 截图 `/tmp/rcm-system-update-desktop.png`、`/tmp/rcm-system-update-mobile.png` 已查看。未改输入流程，未复测中文输入法；未做实体手机验证。
- 未在有运行会话时绕过空闲保护验证成功更新。真实 launchd 提交和运行保护已验证，结果见下文。空闲状态下由按钮完成整条更新和重启流程未做真实端到端验收，不能将模拟测试描述为通过此项。

## 部署

部署前版本 694f0027c61d28aab8c54b8d9b337c711555fa98 是当前 master 的祖先。其他会话已独立提交 AGENTS.md 规则精简与端口约定（49755a5），本次功能提交基于它，未覆盖其修改。


正式功能版本 `cd010569f4dafbe796d5fe69162a787473d92baa` 已推送 origin/master，并通过标准安装上线。安装源为持久化干净 master 副本 `~/Library/Application Support/RemoteCodexManager/update-source`，origin 指向原 GitHub 仓库；installed.json 已记录该路径和 origin，后续网页更新从该副本执行。真实 fetch origin/master 已成功，未修改 SSH 配置或主机校验。

标准安装保留空闲检查、当前 Codex 会话精确豁免、加密备份和版本健康检查。备份：`~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。正式 GET /api/version 与版本一致，GET /api/system/update available=true。

正式浏览器 p2 点击新按钮，独立 launchd worker PID 88781 实际执行运行状态检查。当前本机会话正在运行，job 转 failed 并明确提示等待空闲。正式版本保持不变，未停止任务；此检查证明网页操作没有伪造 Codex 会话豁免。后台进程正常退出并释放部署锁。浏览器空间 25 已关闭，预览已停止。
