# 运行图标与通知会话定位

运行中的侧栏图标优先展示实际运行入口；空闲时继续展示原生 originator 对应的创建来源。悬停说明保留创建来源和当前运行端，不修改原生会话数据。依据用户截图及 creation-activity、activity-icons 既有验收记录调整。

手机通知新开窗口携带 host 和 thread；初始化读取会话链接，优先于此前保存的视图。已有窗口通过消息切换会话，提前监听并暂存初始化期间的通知点击，沿用原有草稿、选择版本及断连恢复机制。跨连接跳转先保存草稿；手动切换连接清除旧会话链接。

验证：npm test 全部通过（229 Node、53 Python），git diff --check 通过。新增 worker 冷启动/已有窗口和运行端图标回归测试。ego-browser 空间 134 使用独立 4327 预览及 API fixture，验证冷启动直达 qa-b、已有页面通知切换、草稿保留、断连后恢复仍选择通知会话；桌面与 390px 无横向溢出，项目方向键及 solid 焦点反馈正常，无脚本错误。截图 /tmp/rcm-notification-desktop.png、/tmp/rcm-notification-mobile.png 已查看，空间已关闭。模拟断连没有核验失败提示文字。未改变输入提交流程，未复测真实中文候选窗。

浏览器验收为模拟业务与通知点击；未接管、发送或停止真实任务。iPhone 主屏幕系统通知的冷启动、锁屏点击及系统行为仍待真机验证。

部署基线 c87eaaa92d2f5a6911662df5ac4edcaff0749296 已核实为当前 master 祖先，保留已上线功能。部署结果待下方补记。

正式部署：5353174f38df8f053c09ab481e6fa0f694f5c111，安装程序完成双重空闲检查、备份与版本健康检查。仅重启 RCM 网页服务。备份为 backups/marco-20261019T130404525141Z.tar.gz.age（位于本机 RemoteCodexManager 支持目录）。首次 Git 推送遇 SSH banner 超时，随后重试。
