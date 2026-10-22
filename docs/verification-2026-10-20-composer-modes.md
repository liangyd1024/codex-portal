# 手机输入工具栏调研与计划/目标入口

## 输入法上方的工具栏

用户红框是 iOS Chrome 的密码、银行卡、地址手动填充工具栏和收起键盘按钮，属于浏览器原生界面，不是 RCM DOM。现有 `message-form` 与 `message-input` 均已有 `autocomplete="off"`。输入框使用原生 textarea，没有可验证的网页属性能强制关闭 Chrome 的原生工具栏。本次不声称已移除该工具栏，不改成密码框、不禁用键盘、不替换为未经输入法验证的编辑器。

调研来源：
- [Chromium iOS Manual Fill](https://issues.chromium.org/issues/40577448)：原生 keyboard_accessory_view 实现。
- [Chromium autocomplete=off 处理](https://issues.chromium.org/issues/41163264)：浏览器可以忽略该自动填充提示。
- [Apple inputAssistantItem](https://developer.apple.com/documentation/uikit/uiresponder/inputassistantitem)：UIKit 原生输入辅助栏接口，不是网页 DOM 属性。

## 修改

依据用户截图和仓库已有 `verification-2026-10-18-composer.md`、`verification-2026-10-18-composer-master-production.md` 验证记录，保留原生 collaborationMode 和 goal 接口语义，没有更改目标执行能力。本轮未重新读取 Codex 原生界面，不宣称像素级完全一致。

- ＋菜单移除执行模式下拉框及“默认”选项；计划、目标、技能、插件平铺，计划作为可切换按钮并显示勾选。
- 加号旁显示“计划 ×”，点击退出计划；普通执行不显示模式标签。
- 目标标记取自实际会话目标，分别显示进行中、暂停、完成或状态待确认，点击打开既有目标设置。保存失败或取消不会虚构已启用状态。
- 手机端不再隐藏计划/目标标记；技能/插件原有摘要保持原行为。
- 计划与目标是原生的独立状态；同时启用时并列显示，退出计划不会擅自暂停或完成目标。新建草稿尚无原生会话，仍沿用现有保存首条消息后设置目标的边界。

## 验证

- `npm test`：236 Node + 53 Python 通过；`node --check public/composer.js`、`git diff --check` 通过。
- ego-browser TaskSpace 1，独立 4327 预览，RCM_MOBILE=0 和全新绝对路径状态目录。
- 浏览器加载真实 composer 模块、模拟目标 API：计划开启/退出、请求 mode 保留、会话切换隔离及切回恢复、运行时禁用、目标保存成功、暂停状态、状态读取失败、保存失败保留内容且不显示目标标记均通过；方向键导航与 Escape 关闭通过。
- 真实预览前端的新会话草稿中：390px 显示加号旁计划标记；桌面取消计划后标签隐藏且文字草稿保留；两种布局均无横向溢出。合成 composition/Enter/229 事件没有产生 POST，使用请求防护确保测试不会发出任务。未创建原生会话或向已有会话发送消息。
- 截图 `/tmp/rcm-composer-real-390.png`、`/tmp/rcm-composer-real-desktop.png`。浏览器测试结束已关闭任务空间。
- 未验证 iPhone 真机键盘或真实中文候选窗；浏览器模拟不等于原生 iOS 验收。目标 API 使用模拟验证，未创建真实目标。

## 部署

部署前正式版本 `66cc8db114996c716ebb75b5dfb3de930c0c9c07`，当前 master 包含该版本。功能提交 `b7b58d9` 已推送 origin/master。标准部署首次被其他运行会话 `REDACTED-ID` 的空闲检查阻止；等待后重试又检测到其他会话产生的未提交修改。未绕过检查，未停止任何任务，正式网页尚未更新。独立预览进程 81647 已关闭。需在其他会话完成后从包含全部修改的最新 master 重新验证并部署。
