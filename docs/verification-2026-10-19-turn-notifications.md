# 每轮执行结束通知验收

用户要求每个会话每次执行结束都通知。以当前正式版本 f724ce5d2c4877845a4f65eae5950005a831b5bd 为基线核对，master 已包含该版本，无其他未提交修改。

使用原生 turn/completed 事件，completed、failed、interrupted 分别提示完成、失败、停止；正在查看的前台会话也发送通知。保留按机器、会话、轮次去重及审批/提问/目标受阻提醒。目标 complete 不再单独通知，避免同次执行完成重复提醒。恢复订阅时从原生分页历史补发最近结束的轮次，不改写原生数据。

验证：新增 3 项回归覆盖终态、独立会话/轮次、重复事件、无效事件、目标去重、恢复分页和时间边界。npm test：197 项 Node、45 项 Python 通过，日志 /tmp/rcm-notifications-tests.log。git diff --check 通过。

ego-browser 独立预览 http://127.0.0.1:4327，状态目录 /tmp/rcm-notifications-20261019-1555；注入现有 fixture 拦截所有业务 API 和事件流，Notification 使用模拟实现。聚焦当前会话时成功/失败/停止各生成通知，重复事件不新增通知；测试按钮 Enter 可触发且焦点可见；桌面和 390px 窄屏无页面横向溢出。截图 /tmp/rcm-notifications-desktop.png、/tmp/rcm-notifications-mobile-final.png。未修改输入流程，未复测中文输入法。

真实系统通知横幅及真实引擎完整执行未验；没有向现有会话发测试消息，没有停止或重启目标引擎。通知依赖浏览器权限和系统设置，页面关闭期间不实时推送，恢复连接后补发。
