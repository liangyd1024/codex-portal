# 消息详情移入更多菜单

依据用户截图及明确确认，复用现有更多操作菜单，将消息详情开关固定放入菜单；桌面会话页和窄屏共享同一按钮与事件。桌面首页无会话时不显示空菜单。按钮固定命名“消息详情”，aria-pressed 和勾号反映开关状态。页面初始化默认收起，不再读取／保存旧 messageDetails 偏好。原始正文、失败轮次及错误提示保持原样。未宣称直接验证了 Codex 桌面原生菜单的一致性。

## 验证

- npm test：192 项 Node、45 项 Python 通过；/tmp/rcm-details-menu-tests.log。
- ego-browser TaskSpace 110，4327 / RCM_MOBILE=0 / 全新 /tmp/rcm-details-menu.* 状态目录。真实首页连接成功，未操作既有会话或发送引擎任务。
- 用 DOM 模拟会话和错误展示，实际 UI 事件处理开关：默认辅助信息隐藏，错误可见；点击后显示且 aria-pressed=true，菜单关闭并返回焦点；Tab 焦点轮廓、Enter 切换、Escape 关闭通过。
- 桌面展开菜单截图 /tmp/rcm-details-menu-desktop.png；390px 窄屏无横向溢出，截图 /tmp/rcm-details-menu-mobile.png。窄屏截图是收起菜单状态，未将其视为窄屏展开菜单操作验收。
- 手动设置测试页面旧偏好 messageDetails=true 后重载，仍默认收起。
- 未做实体手机、真实中文输入法、真实断网或取消任务测试；本次未改输入和任务执行流程。

## 部署

- 正式基线 129a99b0327539600a0758d5edfd0bc62b20a5ae 为 master 祖先；已推送并安装 12a1b5e4d4593bcad24547cada9b2a420df7bd13。
- 备份前和重启前检查通过，仅豁免当前部署会话；备份 /Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261019T082212348918Z.tar.gz.age。
- 版本健康检查通过，local connected，当前部署会话已恢复。原生引擎 PID 1596 和启动时间保持不变。
- 正式静态资源确认消息详情按钮放入菜单、默认收起逻辑生效；本次上线后未再次做浏览器视觉验收。
- 此部署结果补录为纯文档，不再重启网页。
