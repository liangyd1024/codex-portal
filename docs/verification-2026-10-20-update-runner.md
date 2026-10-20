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

## 双机部署

6f63540df0382d2b46578459e4da02467ccb7fc1 已推送。Marco 标准部署完成，备份 marco-20261020T130227931760Z.tar.gz.age；正式同版本更新返回 succeeded/unchanged=true，旧失败提示已由真实新结果替代。

Ally 使用正式服务的独立 Node 路径，在 PATH=/usr/bin:/bin:/usr/sbin:/sbin 下运行共享完整测试入口：291 Node、55 Python 通过（/tmp/rcm-runner-ally-tests.log）。标准部署完成，备份 ally-20261020T130338225559Z.tar.gz.age。两台只重启 RCM 网页，未停止原生引擎或任务。下一步使用此验收文档提交验证 Ally 网页更新真实完整链路。

## Ally 真实网页更新完整链路

正式更新接口仅提交一次，job 74436366-6147-4739-bcda-fe42b18d0079，从 6f63540 更新到验收文档提交 f70a1a6063602c198588610cf6e25ff8d9dcec4f。最终正式 GET /api/system/update 返回 succeeded、unchanged=false、版本一致。后台执行完整 Node/Python 测试（Python 55、Node 与前述同套291；日志 Node 阶段约7.28秒）、备份 ally-20261020T130603205153Z.tar.gz.age、标准安装及健康检查，服务自动恢复。更新约23.4秒完成，没有 npm ENOENT。

SSH 状态回传曾长时间延迟，新连接核对未成功；未重发更新请求。随后复用原连接获得原 job 的成功终态及备份、部署日志，明确解决了此前“完整链路未核实”的限制。该次延迟没有被当作更新失败或成功进行猜测。
