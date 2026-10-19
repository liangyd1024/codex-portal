# 输入交互补修：master 正式版验收（2026-10-18）

## 版本与发布

两项剩余补修已统一提交到 master / origin/master：`231c769c48be3d1d66ab503eb7d16839f0392499`。包含新建页项目列表迟到后自动更新，以及技能/插件搜索无匹配结果提示。原本的输入框布局、加号工具菜单、能力目录按需读取等改动已包含在统一 master 中。

按用户授权串行协调，由「排查并修复问题」完成发布，本聊天核对版本并进行正式页验收。正式服务 `/api/version` 返回 231c769；app.js、composer.js、composer.css、new-chat.css、skill-suggestions.js 的 SHA-256 与 master 文件一致。后续 master 新增文档不影响本次运行代码。

部署前备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T125328437672Z.tar.gz.age`。安装记录时间为北京时间 2026-10-18 20:53:33。

## 自动测试

master 的 `npm test`：117 项 Node、25 项 Python 全部通过。日志 `/tmp/rcm-master-composer-tests.log`。`git diff --check` 通过。

## 231c769 正式网页：真实服务

Ego Lite TaskSpace 73 的 p1，访问 `http://127.0.0.1:4317/`，没有模拟 API。仅操作专用会话 `01a14f15-694e-77b2-87e7-d3aea23e9547`。

- 新建页选择 remote-codex-manager，真实技能目录返回 184 项；输入不存在的名字显示“没有匹配的技能”，搜索 ego-browser 恢复匹配行。
- 创建会话 HTTP 201，一次创建。文本首轮 HTTP 200，收到“UI验收通过”。
- 添加图片并发送下一轮 HTTP 200，收到“图片验收通过”。两轮均 completed，最后 idle；后台命令、队列为空，goalError 为空。
- 创建和两次消息请求均携带 access=full；图片轮次 images=1。成功后草稿与附件清空，停止按钮隐藏。
- 模型菜单展开，思考档位 medium → low，计划模式 → 默认模式切换、目标设置打开与取消通过；未保存目标或额外发起任务。
- 1440×900 桌面、390×844 窄屏无横向溢出。窄屏输入框宽 366px、发送按钮 48×48px；带图片输入框底部位于视口内。
- 刷新页面先恢复本地输出，随后同步到真实会话并恢复可输入状态；仍为两条用户消息和两条回复，无重复消息。
- 记录期间浏览器脚本异常和 CSP 违规均为 0。

结构化证据：[真实请求与结果](composer-master-production-evidence/real-checks.json)。

截图：[桌面新建](composer-master-production-evidence/production-new-desktop.png)、[技能搜索](composer-master-production-evidence/production-skill-search.png)、[窄屏图片草稿](composer-master-production-evidence/production-mobile-attachment.png)、[窄屏两轮完成](composer-master-production-evidence/production-mobile-completed.png)、[桌面恢复后](composer-master-production-evidence/production-desktop-completed.png)。

## 231c769 正式资源：模拟异常验证

同一 TaskSpace 的 p2 加载正式 4317 的静态资源，API/SSE 全部由专用 fixture 拦截；以下不冒充真实服务故障复现。

- 项目请求暂缓返回时列表为 1 项，放行后自动更新至 2 项，中文草稿保持不变。
- 无匹配提示出现后，恢复搜索词显示匹配行并隐藏提示。
- 方向键打开加号菜单时焦点进入添加图片；Escape 关闭并返回入口。技能选择回填引用并返回输入框。
- 模拟目录超时显示简明错误与重试，重试恢复列表；关闭加载弹窗后，迟到响应不会重新打开弹窗。
- 合成中文 composition/Enter 不触发发送；Shift+Enter 保留换行；断线和恢复保留文字及引用。
- 首条消息发送失败时保留草稿、技能引用和图片。重试后成功清空，创建请求始终只有 1 次，失败与成功发送均为完全访问。
- 390×540 短屏菜单位于视口内，无横向溢出。模拟测试中脚本错误为 0。

[修复前短屏菜单](composer-master-production-evidence/production-simulated-mobile-menu.png)。

## 实际限制与观察到的异常

不能将本次结果描述为“所有接口完全无异常”：正式服务重启恢复订阅时遇到已有归档/缺失会话及一次 thread/resume 超时，随后连接恢复。创建请求耗时约 23.9 秒，图片发送请求约 35.6 秒，均成功且没有自动重复提交。过程中出现“标题生成超时”“workspace routing discovery timed out”及短暂目标状态待确认；独立读取随后确认目标状态恢复，两轮聊天均完成。这些引擎/辅助命名路径的问题没有被本轮 UI 补修根治，也没有通过停止目标服务或绕过检查处理。

实体手机 Safari/Android、真实系统中文输入法、SSH 目标上的图片端到端未测。中文输入法验证仅为合成事件。Codex 原生 UI 读取先前被工具安全策略阻止，未声明原生像素级或全部键盘行为一致。

最终逐图检查发现窄屏菜单的“添加图片”保留 icon-button 类，被移动端规则限制为 44×44，文字竖排重叠。已在移入菜单时移除该类，预览验证按钮恢复为 218×44，文字水平；选图逻辑不变。重新运行 npm test 全部通过。最新发布与复验结果见下节。


## 窄屏菜单补修与再次发布

最新正式版本：`a1bad52b8819678952b60aa06a14888ce6a230b6`，已提交并推送 master，安装脚本空闲检查、加密备份和健康检查通过。部署前备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T130523355048Z.tar.gz.age`。

- 自动测试再次通过 117 Node +25 Python，日志 `/tmp/rcm-master-menu-tests.log`。
- 4327 空闲后使用全新 `/tmp/rcm-menu-preview-20261018-final` 状态目录、`RCM_MOBILE=0` 启动预览；未使用 4328，未停止其他预览。
- 最新正式静态资源配合模拟 API：390×540 与 1440×900 的添加图片菜单宽 218px，窄屏高 44px，文字水平，无横向溢出；ArrowDown 聚焦添加图片，Escape 关闭并返回 summary。
- 通过点击添加图片唤起文件选择，选择图片后附件预览出现、菜单关闭。模拟页尝试移除时自动化报 element is not connected，未将该次操作标为通过。
- 模拟页截图中的“找不到模拟会话”来自旧 fixture 会话缓存与当前 fixture 列表不一致，不是正式服务返回。

修复后截图：[窄屏菜单](composer-master-production-evidence/production-fixed-mobile-menu.png)、[桌面菜单](composer-master-production-evidence/production-fixed-desktop-menu.png)。

最新真实服务复验：版本接口确认 a1bad52，页面恢复两轮缓存消息。但连接初始化出现多个旧订阅 thread/resume 30 秒超时，第一次等待 60 秒未恢复可输入；因此上述 231c769 的真实文本/图片发送结果不冒充 a1bad52 全链路通过。最终连接已恢复为 connected，但专用测试会话因恢复订阅超时退回查看模式，未再次接管或发送；之前两轮记录完整显示。


连接恢复后，在 a1bad52 真实新建草稿页（未创建额外会话）完成 390×844 菜单及文件选择验证：点击添加图片、文件选择、附件预览、菜单自动关闭、移除附件均通过，无横向溢出，最终附件数 0。[真实正式页菜单](composer-master-production-evidence/production-real-fixed-mobile.png)。本轮新增代码仅改菜单按钮样式类，真实发送链路的成功证据仍属于前一正式版 231c769；最新版本不标记为完整发送链路通过。

最新版本的连接恢复慢与订阅超时尚未修复；按串行协调安排，本轮不扩展修改引擎、命名或目录超时路径。实体设备和真实系统中文输入法仍未验证。
