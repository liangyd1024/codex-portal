# 两台机器更新失败复发排查

## 两个不同原因

- Marco 正式 web-update.log：test/mobile-session.test.mjs 文件级失败，Node internal/test_runner 报 Unable to deserialize cloned data due to invalid or unsupported version。当前服务 Node v24.11.1 内置 runner 的消息长度仍使用有符号运算。上次证书超时修复没有覆盖此问题；更早记录中已出现此异常，但仅复跑成功，未解决触发条件。
- Node 上游 #64061、#64706 及 #65934 记录同类问题：报告协议与非 ASCII stdout 混合时可能解析错误。资料：https://github.com/nodejs/node/pull/64706 ，https://github.com/nodejs/node/issues/65934 。本机最小合并帧加中文输出实验复现同一堆栈，/tmp/rcm-node-stream-repro.log。原业务测试单独重复 20 次未复现，符合时序相关特征，不能将一次成功当修复证据。
- Ally 身份核对 ally / allydeMacBook-Pro.local / /Users/ally。正式日志两次为 spawn npm ENOENT；服务使用 Codex runtime 的独立 Node，后台 PATH 不含 npm，因此没有启动测试。不是断言失败，也不是证书超时。

## 修复

- npm test 与更新流程共用 scripts/run-tests.mjs，直接用当前 Node 执行全部 Node 测试，成功后执行全部 Python 测试。网页更新不依赖 npm 或 shell 配置；不存在跳过测试、失败自动重跑或取消进程隔离。
- 6 处中文测试目录输出改为 t.diagnostic，走测试报告通道而非混合 stdout。保留原诊断信息和测试目录，不改 Node 或 Codex 引擎文件。
- 后台错误按“运行器内部通信异常／测试命令无法启动／超时／断言失败及文件”区分；完整日志保留，不把命令未启动统一叫测试未通过，也不将原始日志全部展示到网页。

## 验证

- npm test：291 Node、55 Python 通过，/tmp/rcm-runner-full.log。
- launchd Standard 且 PATH 仅 /usr/bin:/bin:/usr/sbin:/sbin，无 npm；绝对 Node 执行共享入口，291 Node、55 Python 通过、exit 0，/tmp/rcm-runner-launchd.log。
- 修复后 mobile-session 单项连续 20 次通过；共享入口测试验证 Node/Python 错误码传播及前项失败后不执行后项，诊断分类验证不泄露原始日志。
- ego-browser 空间 38、独立 4327 预览、API fixture，错误长文案桌面及390px可读、无横向溢出、Tab焦点solid、失败后更新按钮可用。未改变输入流程，未测中文输入法和实体手机。未将模拟状态称为真实更新成功。
