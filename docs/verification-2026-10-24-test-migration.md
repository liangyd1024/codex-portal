# 旧测试迁移验收

基线：`fa0a0ab167ef0dbc01208bde72456d3543df9472`。迁移提交可通过本文件的 Git 历史定位。

本次核对旧目录中的 17 个测试及样本文件。只迁移测试和验收文档，不修改生产代码，不部署网页服务。

## 迁移范围

| 旧文件 | 处理结果 |
| --- | --- |
| catalog-refresh.test.mjs | 保留目录刷新失败、分页完整性和连接替换检查。使用显式虚构目标。 |
| connection-state.test.mjs | 保留状态序号、服务实例切换和历史与实时输出合并检查。 |
| detail-cache.test.mjs | 保留跨目标隔离、精确增量、重复行、中文及 gzip 解码检查。 |
| manager.test.mjs | 适配显式目标、账号读取和只读详情接口。保留并发、审批、重连、停止服务前检查及状态持久化。 |
| mobile-access.test.mjs | 保留配对码单次使用、限流、到期、撤销和永久登录持久化。 |
| mobile-server.test.mjs | 使用显式注入的模拟管理器。保留 Origin、CSRF、远程入口及撤销后 SSE 关闭检查。 |
| model-restore.test.mjs | 保留模型目录迟到时的偏好恢复；将跨项目加载检查适配为 sidebar 快照。最长路径匹配迁入 test_sidebar.py。 |
| output-relay.test.mjs | 保留断线输出、订阅去重、慢消费者隔离、Unicode 和通知日志持久化检查。 |
| output-window.test.mjs | 保留 12 MiB 输出分页及固定位置检查。 |
| passive-store.test.mjs | 补齐当前快照字段和项目表。保留 SQL 字面量、稳定分页、193 项完整性、SQLite 不变性及 WAL 一致性检查。 |
| protocol-check.test.mjs | 保留可选接口缺失、新必填字段、缓存失效及握手不兼容检查。 |
| fixtures/request-contract.json | 更新为固定的合成参数名样本。运行测试时不从实现动态生成样本。该样本不证明真实引擎兼容。 |
| rpc-client.test.mjs | 保留握手顺序、乱序关联、审批 ID 类型、超时、二进制帧及连接清理。 |
| server.test.mjs | 适配显式管理器映射，隔离真实配置与更新器。保留 HTTP 防护、中文分块、连接隔离、SSE 和 gzip 检查。 |
| ssh.test.mjs | 保留压缩与 UTF-8 检查。SSH 参数使用虚构配置；不建立真实 SSH 连接。 |
| startup-output.test.mjs | 保留启动前缀、命令身份、重复行、预览及增量还原检查。 |
| task-notifications.test.mjs | 合并类型化请求 ID、稳定工具身份和跨目标键隔离检查。保留新版通知语义。 |

## 不保留的旧要求

- 不再要求重连时向网页补发历史完成通知。新版已有 task-notifications.test.mjs 和 live-notification.test.mjs 覆盖静默历史恢复。
- 不再要求普通轮次完成时不通知。新版按实时终态通知。
- 停止服务测试明确传入维护确认，并使用模拟服务。保留运行任务、目标、后台命令、排队输入及在途写入阻止停止的断言。
- 项目归属由新版快照处理，不恢复已删除的前端 projectForThread 函数。

## 验证

- 迁移相关测试通过后，运行 `node scripts/run-tests.mjs`。这是 package.json 中 npm test 调用的同一个入口。
- 当前运行环境没有 npm 命令，使用可用的 Node 运行时直接调用入口。
- 完整 Node 测试：598 项通过，0 失败、0 跳过。
- 完整 Python 测试：70 项通过。
- 测试只使用模拟 RPC、临时数据库和回环 HTTP。临时目录保留，不递归删除。
- 本次不包含真实目标机或手机交互验收，也不宣称验证了真实引擎协议兼容性。
