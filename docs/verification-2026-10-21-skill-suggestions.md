# 技能候选列表名称与匹配

依据用户提供的网页与 Codex 桌面截图，以及本机原生 SkillMetadata / SkillInterface / SkillScope 类型，使用 interface.displayName、interface.shortDescription、shortDescription、scope 和 pluginId 展示元数据。未读取或改写技能文件。

- 用 Grid 为名称保留空间，让说明优先截断。系统字体 16px，复用线框图标，低饱和选中底色；来源显示个人/项目/系统/管理员或原生插件 ID。悬停可读完整说明和路径。
- 按名称完全匹配、名称前缀、名称包含、说明包含排序；同层级保持原生目录顺序。只去重相同路径，不合并不同来源的同名技能。
- 窄屏名称与说明分两行，保留至少 44px 点击区域。选择仍使用原始 name/path，未改变原生技能调用协议。

验证：

- skill-suggestions 6 项测试通过；npm test 全量通过，日志 `/tmp/rcm-skills-tests.log`。
- ego-browser space 56，4327 独立临时状态、隔离模拟 API。1280×900 时 Multica CLI、Music to Video、dingtalk-shared 三个名称的 clientWidth 与 scrollWidth 相同，未截断。390×844 无横向溢出，名称完整，两行行高 66.75px。
- 方向键加 Enter 选择 `$music-to-video`；点击选择 `$multica-cli`；两者均关闭列表，没有发送消息。合成 composition + Enter 不选择、不发送。无 JS 错误。
- 浏览器最小化，截图未完成；未验证实体手机、真实中文输入法候选确认或真实引擎技能执行。只修改列表呈现及排序，未改变提交语义。
- 部署前正式版本 `fc1f1270deef6183a9d8ea9c182c7071409735f0`；部署结果随后补录。

发布结果：功能提交 `90df796` 已推送 origin/master。全量测试为 301 项 Node、55 项 Python 通过。安装程序多次复查仍发现本机会话“$multica-cli 我的这个CR版本需要升级吗”运行或状态待确认，退出码 1。尚未备份、重启或上线；正式网页保持 `fc1f1270deef6183a9d8ea9c182c7071409735f0`。待该会话空闲后再部署。验收空间及本轮预览服务已关闭。
