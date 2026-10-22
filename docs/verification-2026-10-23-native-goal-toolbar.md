# 原生目标栏交互

## 原生依据与实现

依据用户提供的 Codex 目标栏截图，保留垃圾桶与暂停／继续，省略放大按钮。只读核对已安装桌面包：app-primary-58a09006cc0c.js 的 composer.threadGoal.clear、pause、resume 按钮；app-initial-c95ddb62696e.js 的 clearThreadGoal 调用 thread/goal/clear，setThreadGoalStatus 调用 thread/goal/set。协议包含 ThreadGoalClearParams 的 threadId、origin，以及 cleared 布尔回执。未修改安装文件。

输入框上方显示原生目标状态、已用 token 与累计秒数（有值时）。只显示原生累计值，不新增计时器或轮询。右侧只有删除及暂停／继续。阻塞与暂停可继续；预算与用量受限保留明确状态，不绕过限制。删除仅清除当前目标，不删除会话，不将目标标为完成。保留加号菜单内目标编辑，移除重复的状态操作菜单与现有目标底部徽标。

后端删除调用 thread/goal/clear，明确 origin=user，增加独立 goalClear 协议检查。暂停允许在活动轮次期间设置原生 paused，不额外调用 turn/interrupt。继续仍拒绝活动轮次。thread/goal/cleared 通知触发原有合并刷新。

## 验证

- 基线 master `79f336f`，保留另一会话已提交的静默成功提示等改动。正式版本 `b1c96e3` 为本基线祖先。代码版本见本记录所在提交。
- npm test：435 项 Node、69 项 Python 通过。新增清除目标、原生暂停、能力不支持、错误传播、生命周期与状态不确定测试。
- ego-browser 独立 4327 预览，使用全新状态目录。模拟 API 覆盖继续、暂停、删除、失败、挂起防重复、草稿保留、删除后输入焦点及跨会话迟到响应隔离。无重复消息写入，无浏览器脚本异常。
- 桌面 1440×900 核对目标栏、键盘 Enter 操作和失败反馈。没有放大按钮。
- iPhone 12/14 共用 390×844、DPR 3、5 触点，启用移动视口与触控模拟；操作前核对参数。touchStart/touchEnd 验证继续和删除；按钮均 44×44，无横向溢出。844×390 横屏无溢出（目标删除后）。未实测实体手机软键盘、中文候选窗、系统选区及剪贴板。本次没有修改输入事件。
- 真实服务验证：预览连接就绪后创建专用测试会话，原生设置 paused 目标；读取为 paused/idle。删除返回 cleared=true，再读 goal=null、goalError=null、会话 idle、零轮次。没有触发模型执行或操作原业务目标。初次连接未就绪时两次请求被 DISCONNECTED 拒绝，没有创建会话；连接就绪后成功。
- 运行中暂停和继续执行仍为模拟验证，未用真实模型复测。桌面原生代码与请求契约已核对，不宣称全链路完全一致。
- 性能：状态随现有刷新读取，无新增轮询；操作仅一个目标 POST 和原有详情刷新，无额外 turn/start。图标只在动作切换时更新。未测量 CPU、内存，不声称性能最优。

## 部署

提交推送后按标准安装流程执行。正式结果另行记录。
