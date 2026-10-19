# 分区与项目运行提示

按用户截图标注，在分区名和项目名后汇总其当前列表子会话的运行来源，复用会话 activitySource 判断与运行图标。折叠仍显示；网页和桌面来源分别汇总，悬浮及无障碍名称提供数量。结束、过期及断连沿用原判定。被移动或置顶的会话按实际侧栏层级汇总，不重复归入原项目。没有新增引擎状态或修改原生数据。

依据为用户截图、现有会话图标及 docs/verification-2026-10-19-font-alignment.md 的桌面样式核实记录；未声称与桌面原生汇总样式完全一致。

验证：相关测试 7 项通过；完整 npm test 为 Node 221、Python 53 项通过。ego-browser 在 4327 新隔离状态预览中加载真实 Sidebar/CSS 与模拟数据，检查 1440×900、390×844，折叠提示、键盘左右键、焦点保留、断开及完成后清除、无横向溢出均通过。截图 /tmp/rcm-sidebar-running-desktop.png、/tmp/rcm-sidebar-running-mobile.png。图形内容使用测试 SVG 占位，未连接真实会话进行运行端到端测试；未改输入流程。首轮窄屏被应用监听干扰，改为无应用脚本的同源夹具复测通过。

部署前正式基线 5b8984391ba59b54d9843682e668cfa35af4b9b2 已包含在 master。部署结果后补。

正式部署完成：f98d77e33248f7ab1de700ec24a570c653ea1f07。安装器通过当前会话精确豁免及其余空闲检查、加密备份、重启网页和版本健康检查。备份 /Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261019T110858766726Z.tar.gz.age。未停止原生引擎或运行任务。最终窄屏夹具补齐 sidebar-open 容器，在同轮设置 390px 并确认 innerWidth=390、无溢出、项目按钮焦点，截图已更新。
