# 运行中会话的技能提示与补充

## 修改与依据

原技能候选 update/choose、输入工具 render 将 active 当成禁用条件；active 发送和 sendAfterGoal 又只保留 text/images，即使草稿已有引用也丢失结构化技能。现允许运行中搜索、选择技能及插件，并把当前草稿的引用传入 steer。

使用已核验本机原生 TurnSteerParams.input / UserInput 的 skill 类型，复用 turnOptions 对目标项目的技能/插件目录重新核对。发送保持 expectedTurnId，不启动新轮次，不修改运行中的模型、权限或协作模式。目录读取后再次核对控制权和连接代次；失效路径、断线、切换连接时不向原轮次提交。图片、文字原有补充方式保留。

## 验证

- 相关 26 项测试通过，新增运行中结构化引用、失效路径、连接切换及补充参数过滤测试。
- npm test：319 项 Node、58 项 Python 全部通过，日志 `/tmp/rcm-running-skills-tests.log`。
- 4327 被其他开发会话 PID 92198 占用，未停止或重启该服务。仅使用当前目录静态资源，ego-browser space 72 注入隔离 fixture 拦截业务 API/SSE。
- 1280×900 和 390×844 运行中输入 `/测`、`$测` 都显示候选；Enter 选择后经 /steer 发送，载荷含 skills 路径，没有 /message 或新建轮次请求。窄屏行高44px，无横向溢出。
- 模拟失败保留 `$测试技能` 草稿及原引用；合成 composition + Enter 不误选/发送；断线关闭候选并禁用输入，草稿保留。技能/插件入口运行中可用，计划切换仍禁用，无 JS 错误。
- 已查看截图 `/tmp/rcm-running-skills-desktop.png`、`/tmp/rcm-running-skills-mobile.png`。未验证真实 IME、实体手机或真实引擎执行技能的闭环。浏览器验收空间已关闭。

## 协作与部署

开始时存在其他会话未提交改动，已保留；其后这些改动由其他会话自行提交。本次提交前再次核对 diff，仅包含本需求修改。部署前正式版本为 `e08b6899944a2a520e4a92a145ca6bef8e09799c`，当前 master 保留其全部功能。部署结果随后补录。
