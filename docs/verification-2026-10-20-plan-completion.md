# 计划完成后的执行选项

## 原生依据与实现

只读检查本机 ChatGPT.app 的 app.asar：src-DsLVGakC.js 在成功完成的 turn 中取最后一个非空原生 plan 项，生成桌面执行选项；pending-request-item-panel-a6ee45e20086.js 确认后切换 default，plan-implementation-request-0cd55f1ae7b1.js 使用 `PLEASE IMPLEMENT THIS PLAN:` 前缀携带计划原文。未修改桌面文件或原生数据。

网页在最新轮次成功完成且包含原生 plan 时，在输入框上方显示“执行此计划？”、“是，执行此计划”和“暂不执行”。按用户要求，此时清除输入框的计划模式标记；该清除时机是本次明确要求，不声称与桌面内部状态完全相同。暂不执行和 Escape 仅收起本标签页的选项，继续输入仍使用普通模式，可重新选择计划模式。

确认通过现有 message → 原生 turn/start 发送 default 模式和完整计划；不新建执行引擎，不改写原生历史。单独发送确认，不消费文字、图片、目标或技能草稿。仅浏览器展示选择保存在按连接、会话和轮次隔离的 sessionStorage 中，不作为原生执行状态。新轮次开始后旧选项不再展示。

提交期间禁用重复操作；明确拒绝可重试，断线或结果未知须核对会话后手动解锁。切换会话后的回执只影响原操作，保留新会话和草稿。桌面托管任务会话仍由桌面处理，不宣称支持其计划确认。

## 验证

- `node --test test/plan-completion.test.mjs test/composer.test.mjs` 通过：只识别成功完成的原生计划、排除普通正文/空计划/失败/中断/旧轮次，转交完整计划原文及原生协作模式。
- `npm test` 通过（245 个 Node 测试、53 个 Python 测试）。
- ego-browser 模拟接口验收：桌面和 390×844，scrollWidth=390；计划标记清除、执行参数、草稿保留、409 重试、重复点击禁用、503 结果未知保护、断线禁用、Escape 返回输入框、模拟中文 composition 回车不误发送通过。真实手机输入法候选窗未验证。
- 截图保留在 `/tmp/rcm-plan-desktop.png`、`/tmp/rcm-plan-[含个人信息的截图已移除]`、`/tmp/rcm-plan-mobile.png`。首次桌面截图后已将选项宽度与正文、输入框对齐。
- 开发预览运行在 4327，关闭手机入口，使用独立绝对状态目录 `/tmp/rcm-plan-preview-20261020-1043`。

## 真实原生验证

专用测试会话 `REDACTED-ID`：通过现有原生接口以 plan 模式发送无工具、无文件变更的验收要求。引擎完成后返回真实 plan 项；浏览器自动显示执行选项并清除预置的计划标记。点击确认后收到第二个 completed 轮次及原始回复“计划执行验收完成”；输入框中的“这条验收草稿不要发送”完整保留。仅操作该测试会话，未中断其他任务。

交付前完整测试曾有一次 Node test runner 的 `Unable to deserialize cloned data` 进程通信异常；未改测试或绕过检查，完整重跑通过（245 Node、53 Python）。真实结果截图 `/tmp/rcm-plan-native-complete.png`。切换会话迟到响应按选择版本校验实现，本次未完成该场景的浏览器验收。

## 正式部署

功能提交 `01664aca21b569ddf07652cf93869f93f94dea15` 已推送 origin/master；确认包含原正式版本 `5e727102e2f486102fbfae6273376d1b67b7d5fa` 以及其后目标输入和 favicon 修改。标准安装流程两次空闲检查通过，仅精确豁免当前部署会话。

部署前备份：`~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。安装与健康检查成功，4317 `/api/version` 返回上述功能提交。仅重启本机 RCM 网页服务，未停止目标引擎或任务。正式页面未再次发起执行；真实端到端行为验证在独立预览完成。
