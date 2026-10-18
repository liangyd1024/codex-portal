# 手机输入框技能引用部署

- 部署版本：`b44e325fc3b3f6ccf18af0f1ddeb0808b4ec019c`，分支 `codex/mobile-skill-mentions`。
- 前一正式版本：`c695f102883611bd3c49a45a74965cc3f275b403`。
- 标准安装命令：`node scripts/install-local.mjs --ref HEAD`（独立且干净的发布工作树）。空闲检查、加密备份、健康检查通过，未停止目标引擎。
- 部署前备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T121335578582Z.tar.gz.age`。
- 正式 `/api/version` 返回完整发布提交；composer.js、composer.css、skill-suggestions.js、inline-mentions.js 均 HTTP 200，SHA-256 与发布源码一致。
- ego-browser 新页面加载真实 4317，确认没有 fixture，模式菜单为默认/计划/目标，行内引用及候选模块已加载。验收空间 59 已关闭。
- 全部验证和官方来源见 [验收记录](verification-2026-10-18-mobile-skill-mentions.md)。96 项 Node 与 24 项 Python 测试通过；实体手机键盘及真实模型技能执行未验收。

手机已有网页需刷新加载新模块。本轮未变更手机入口地址、证书或配对信息。
