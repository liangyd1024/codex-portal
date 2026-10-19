# 网页创建会话后的桌面发现延迟

## 核查结果与前次结论修正

用户会话「为什么现在任务的通知没有收到呢」ID 为 `01a15344-61fa-7003-8c81-a37b9475f4c4`。只读 state_5.sqlite 显示 cwd 正确、archived=0、project_id=`01a14a84-7ba8-7220-93f4-1c4158aed87b`，与同项目另一网页会话一致。用户确实选了项目，创建未丢失项目参数。

同一桌面 list_threads 工具先返回该会话 projectId=null，后来返回桌面项目 ID `adca835c-405a-41f9-bf89-ed31e9dbb7a2`。用户同时报告后来显示。原生数据库的项目 ID 无变化，说明至少存在桌面读取/缓存/归属识别延迟。不能把工具 projectId=null 直接等同于所有桌面 UI 都没有项目：旧桌面会话也会返回 null，而界面可能按工作目录回退分组。

本机项目迁移状态 threadAssignmentsMigrated=false，threadAssignmentsReadMigrated 缺失，但这只是归属同步链路的条件，不足以独立证明此次延迟全部由迁移导致。前次回复将其直接作为根因过于确定。没有当时完整事件时间线，无法确认是哪一次桌面读取最终触发显示。

## 只读原生实现核对

已安装 `/Applications/ChatGPT.app/Contents/Resources/app.asar`：

- `.vite/build/main-CLu1A25j.js`：项目服务 observeThreads 异步串行处理 thread/list 观察结果和 thread/started；归属观察受迁移、pendingCreatedThreadIds 等条件约束。
- `.vite/build/src-DsLVGakC.js`：原生 IPC query-cache-invalidate 广播，协议版本为默认 0；转交 renderer invalidateQueryCache。
- `webview/assets/app-initial-90eb42395b7d.js`（此前只读提取副本 `/tmp/rcm-desktop-sidebar-bundle.js`）：收到广播后调用 invalidateQueries；recent-conversations-meta 的查询使用 infinite staleTime，live 模式 queryFn 调用 refreshRecentConversations；catalog 模式由原生目录服务维护，不可据此保证一次通知就完成项目识别。

没有修改应用文件、原生存储、迁移标记，也没有伪造归档/恢复事件或伪装桌面身份。尚未找到独立 RCM 服务可以调用的完整桌面项目归属事务接口。

## 本次优化

首条消息成功后，等待已有自动命名作业，再只读确认会话已持久化且未归档，发送原生发现缓存失效通知（recent-conversations、recent-conversations-meta、local command-menu-thread-search）。不等待桌面渲染、不延迟消息返回，不重放创建/消息/项目写操作。

落盘等待最多四次，连接/代次变化取消，桌面未运行视为正常，其他失败只记录诊断。通知是尽力而为的缓存提示，未持久化为业务任务，也未实现 RCM 自己的项目归属副本。网页进程在提示前退出时仍依赖原生后续发现。

## 验证及限制

- 定向测试：IPC 帧、持久化检查、只发送缓存通知、没有数据库写入、不安全 socket 拒绝；首条成功消息仅提示一次、发送失败不消耗提示、标题顺序、落盘重试、连接代次变化、诊断错误。
- 初次全量 npm test：202 Node + 47 Python 全通过；随后新增 manager 集成回归，5 项 discovery 测试通过。
- 真实预览：4327、RCM_MOBILE=0、全新 `/tmp/rcm-discovery-preview.*` 状态目录；仅创建专用会话「RCM 桌面发现同步验收 1019」（01a15362-c673-7e81-8875-d1b363e8506e）。创建 583ms、首条消息提交累计 629ms，项目 ID 与选择一致，模型轮次完成。
- 原生 IPC 未报告刷新错误，桌面 list_threads 可发现测试会话，但两次读取 projectId 仍为 null。因此不能标记“桌面项目归属立即同步”通过，也不能证明 UI 延迟已完全消除。测试过程中出现独立的 codex_apps 30 秒工具目录超时，已作为原生连接器诊断保留。
- 桌面 UI 读取被 Computer Use 工具明确拒绝访问 com.openai.codex，未绕过。此次无 UI 布局/输入修改，未开展浏览器或中文输入法验收，不能把工具列表等同于截图验收。
- 证据：`/tmp/rcm-discovery-probe.json`、`/tmp/rcm-discovery-tests.log`、`/tmp/rcm-discovery-change.diff`。

最终全量验证：203 Node + 47 Python 全通过（`/tmp/rcm-discovery-tests-final.log`）。专用测试会话通过预览的原生归档接口返回 HTTP 200，随后仅关闭本次 4327 预览进程，未停止目标引擎。正式部署前核对当前线上 0146f8b 为 master 的祖先；其他会话新建的 scripts/desktop-session.py 不纳入本次提交。
