# 归档前历史检查修复

## 原因与改动

远程 机器 B 截图会话 `REDACTED-ID` 的只读历史快照复现 `unable to open database file`，另一次读取出现 SSH 超时。原生 `thread/read` 返回 `notLoaded`，`thread/turns/list` 正常返回最近五轮 completed。问题发生在归档写入前的历史检查。

归档前改用原生 `thread/turns/list`（最近五轮，与原快照窗口一致），不再打开被动历史数据库。保留实时状态、后台命令、队列与目标检查；历史格式异常、运行中、未知状态或接口不可用时禁止归档。归档、恢复和桌面通知仍沿用现有原生接口，不接管会话，不修改原生数据库或引擎。

## 验证

- 最终代码 `npm test`：248 项 Node 测试、53 项 Python 测试通过。
- 新增回归：归档不读取被动历史、不接管会话；运行中、未知、格式错误、原生读取失败和不支持接口均阻止写入。
- 独立预览：4327，`RCM_MOBILE=0`，状态目录 `/tmp/rcm-archive-preview-20261020-unique`。
- ego-browser 空间 9，专用远程会话 `RCM 验收 RCM_REMOTE_OK`（`REDACTED-ID`）真实归档成功。此轮使用中间方案（快照打开失败后读取原生历史）；最终方案直接读取同一原生接口，以避免快照等待。
- 本次没有 UI、布局或输入流程修改，未进行 390px、实体手机和中文输入法专项复测。
- 专用验收会话通过网页“撤销”恢复成功，并回到未归档列表。
- 最终代码针对截图业务会话完成真实只读归档预检，执行到原生写入前截停（`PREFLIGHT_VERIFIED_NO_WRITE`），未修改该业务会话。
- 正式部署基线 `01664aca21b569ddf07652cf93869f93f94dea15` 是当前 master 祖先，保留既有上线功能。

## 正式部署

已通过指定提交安装流程部署 `20d6a8ea258e4141158e97f8946d7253025c75b6`，两次空闲检查通过，仅豁免当前部署会话；健康检查和 `/api/version` 确认正式网页运行该版本。仅重启本机 RCM 网页，未停止目标引擎或任务。

加密备份：`~/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`。预览服务已停止，浏览器验收空间已关闭。
