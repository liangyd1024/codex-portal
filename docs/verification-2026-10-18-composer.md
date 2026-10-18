# 新会话同步与输入区功能（代码与隔离验收完成，未部署）

## 问题证据

- 真实正式接口的当前会话历史读取返回 200。桌面日志中的 active writer 属于历史会话，不能作为这次网页版提示的直接原因。
- 正式服务重复记录 `thread/goal/get timed out after 3000 ms`。旧代码把可选的目标读取异常通过 manager/error 推送为全局 toast；聊天读取本身可能仍成功。
- 创建独立临时 Codex Home、独立 stdio 引擎，仅调用 initialize 与 thread/start，不发送消息。原生引擎成功返回 idle 会话，但 state_5.sqlite 的 threads 表中该 ID 的记录数为 0，且 thread_history_1.sqlite 尚不存在。证据目录：`/var/folders/1c/tbrgv3gn6xbc_m1_7qyptt9w0000gn/T/rcm-empty-thread-9dwq3s7n`。测试结束仅终止本次启动的进程，保留目录。
- 正式管理器的专用新建探测另返回 thread/start 30 秒超时。没有自动重试；超时无法证明创建失败。正式引擎还有模型刷新超时与证书 UnknownIssuer 日志，本次未绕过证书校验，未重启共享引擎。

## 修改

- 成功创建的会话保留引擎返回的元数据；只对本入口新建、仍控制且尚无持久记录的会话回退。缺失全新历史库时允许空历史，已有库损坏、字段错误或普通读取异常继续报错。
- 创建超时明确表示结果未知，并提示先核对列表。目标读取失败改为局部状态，保留上次目标，不再反复发全局失败 toast。
- 新建和消息发送支持默认权限、完全访问；按用户要求网页默认完全访问，并按浏览器和连接记住。后端调用未指定时保留默认策略。完全访问映射为 `approvalPolicy: never` 和原生完整访问沙箱设置；切回默认权限使用 on-request/workspace-write。不改变正在执行轮次。
- 计划模式通过 collaborationMode 参数传给引擎。目标使用 thread/goal/set，origin=user；技能从目标项目目录选择，以 skill 类型输入传递。已安装且已启用插件的选择转换为明确插件使用指令，安装及账号授权仍交由 Codex。
- 去掉内置语音 UI 和初始化，系统输入法正常输入。原语音模块和历史测试保留为未加载源码，没有批量删除文件。

## 验证与限制

- 本机生成的原生 JSON schema 核对权限、计划、目标、技能、插件参数，协议校验升级为 policy 6。
- 针对性 Node 回归 14 项通过，覆盖权限切换、计划参数、技能路径及插件目录校验、目标用户来源与忙状态、新会话回退、创建结果未知、目标超时局部错误。Python 全套首次运行 22 项通过，随后补充新建历史库缺失回归。
- 继续验收时重新执行 npm test：77 项 Node、24 项 Python 全部通过，包含手机 LAN 证书生成。此前环境超时未通过的结果保留在前次日志；本次未更改证书算法或测试时限。完整日志 `/tmp/rcm-composer-resumed-tests.log`。
- JS 语法与 git diff --check 通过。
- 用户明确允许重新打开 Egolite 后，在新空间 51 完成模拟浏览器验收，结束时已关闭验收空间。加载实际前端、模拟 API，未向真实任务发送消息。新建默认完全访问，计划、技能与插件选择均进入发送请求；目标保存请求包含 objective 与可选 tokenBudget。默认权限手动选择后刷新可保留，随后已恢复完全访问。技能目录失败可重试，Escape 关闭弹窗、Tab 可回到输入框；中文 composition/Enter 模拟不误发送，草稿保留。
- 桌面和 390×844 截图已检查；390px 的 scrollWidth=390，技能弹窗不溢出，搜索框焦点可见，无内置语音按钮，无页面异常。截图 `/tmp/rcm-composer-desktop-verified.png`、`/tmp/rcm-composer-mobile-verified.png`、`/tmp/rcm-composer-picker-verified.png`；几何及页面异常记录 `/tmp/rcm-composer-browser-evidence.json`。真实手机系统输入法候选窗及真实引擎计划/目标/插件任务端到端执行仍未验收。
- 原生桌面 UI 读取超时，尚不能声称视觉、快捷键与 Codex 完全一致。已参考仓库既有验收和本机原生协议。
- 当前为工作区代码修改，未提交或正式部署。保留工作区原有改动。当前聊天由正式入口执行，不应在运行中重启正式网页服务。部署需按 README 的空闲检查、备份、已提交版本安装与健康检查流程执行；不得把隔离预览描述为正式上线。
