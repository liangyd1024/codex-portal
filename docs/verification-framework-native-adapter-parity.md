# 当前候选原生适配源码边界核对

正式基准为 `227dbfe93ee88718c2437f7b7c7b119570a720a6`，实际预览为 `accb11f2cfe0e6c1e6563de1560c86540978c4ba`。审计工作区提交为 `57efa8a`，本轮没有应用修改。

## 核对方法

从基准 Git 树列举 lib、shared、scripts 中全部 67 个既有文件，逐文件读取基准源码与候选文件，不只依赖 diff 摘要。先比较完整字节，再人工检查四个差异文件。对三个适配模块额外使用项目现有 TypeScript 解析器解析 JavaScript，确认无解析诊断，移除注释，并仅消除包裹 null 字面量的括号后打印、比较摘要。

首次仅移除注释仍报告差异，原因是 `(null)` 与 `null` 的语法表示不同；该轮记录保留。第二轮没有忽略其他表达式括号、字符串、字段、参数、分支或调用。所有差异均已与原始 diff 对照，不将任意“语义相近”的代码归为一致。

| 范围 | 基准既有文件 | 结果 |
| --- | ---: | --- |
| lib | 42 | 39 个字节相同；composer.mjs、manager.mjs、native-automations.mjs 仅增加类型注释及 null 字面量括号，规范化后完全一致 |
| shared | 4 | 全部字节相同 |
| scripts | 21 | 20 个字节相同；run-tests.mjs 增加测试前构建，不属于原生业务操作逻辑 |

没有丢失基准文件。另读取实际预览构建 runtime 下对应的 67 个副本，与本轮候选文件逐字节比较，全部相同。因此上述结论覆盖正在运行的预览副本，而非仅工作区源码。

新增文件单独列出，不计入“既有模块未变”：lib/preview-mobile.mjs，以及 build-framework、generate-shell、start-parity-fixtures、start-preview、typecheck、verify-framework-baseline 六个脚本。它们承担预览隔离、构建及验证；其行为仍须依赖对应测试，不能由本次既有文件比较推导为安全或正确。

## 结论的适用范围

本次证据确认框架迁移保留了既有原生业务适配的运行逻辑，既有共享模块和 Python 辅助脚本未变。它有助于区分应用层迁移风险与原生能力本身的限制。

该审计不证明 Fastify 路由参数、鉴权或响应契约一致；这些由[原始基准接口对照](verification-framework-original-baseline-http.md)和具体路由测试验证。也不证明所有真实任务、排队、目标和文件操作已经执行成功。真实 SSH 证据仍按[单轮及文件验收](verification-framework-ssh-native-roundtrip.md)限定范围记录。不能据此宣布整体迁移或全功能验收完成。

本轮只读源码和构建副本，未连接或操作原生会话、未改动配置、未重启服务。原始文件摘要及比较记录保存在仓库外。
