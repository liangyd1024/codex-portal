# 浮动提示统一为 3 秒

- createToasts 统一在 3000ms 后移除提示。成功、错误、进度提示均适用，包括调用方原来指定的 0、7500、8000、11000ms。保留旧参数位置以兼容操作去重 key。
- 重复同一提示只保留一条，从最近一次提示重新计时 3 秒。手动关闭能力不变。确认对话框、真实连接状态、归档撤销入口不属于浮动 tips，不改为自动关闭。
- 新增回归覆盖默认时长与旧参数覆盖。
- ego-browser 空间 78：以当前 feedback.js 在隔离空白页验证，桌面移除耗时 3002.9ms，390px 手机错误提示移除耗时 3006.5ms；无横向溢出。空间已关闭。
- 当前工作区 npm test 出现 3 个 extension-notice 失败，与其他会话正在修改的 shared/connection-state.js 相关；没有覆盖这些修改。
- 从 HEAD 导出独立临时目录，仅叠加本次 feedback.js 和测试后执行 npm test：332 Node、59 Python 全通过。日志 /tmp/rcm-tip-isolated-tests.log，验证目录记录于 /tmp/rcm-tip-verified-root.txt。
- 正式部署结果后续补录。
