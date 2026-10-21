# 黑色输入框与新建项目接口核查

## 输入框

按用户截图及本次明确要求，将新建会话与已有会话共用的 composer 改为黑色边框、黑色输入文字、黑色操作图标和黑底白字发送按钮。背景保留白色，占位文字和禁用按钮使用中性灰。聚焦外圈与键盘焦点改为黑色。保留技能引用的语义颜色、透明文字镜像和强制颜色模式。仅修改 `public/composer.css`，不改变输入、发送或会话逻辑。

核对样式加载顺序：styles、new-chat、mobile-ui 在前，composer 动态加载在后。新旧会话共用并移动同一输入组件。需求依据为本次用户指定黑色，未声称与 Codex 桌面像素一致。

验证：

- `npm test` 通过：301 项 Node、55 项 Python。日志 `/tmp/rcm-black-composer-tests.log`。
- ego-browser 空间 60，4327 独立预览，`RCM_MOBILE=0`，全新临时状态目录。使用现有 mobile-browser fixture 拦截业务 API 和 SSE，不向真实会话发送消息。
- 新建会话桌面与 390px：边框黑色、文字黑色、发送黑底白字、Tab 焦点黑色实线；页面无横向溢出。已查看截图 `/tmp/rcm-black-new-desktop.png`、`/tmp/rcm-black-new-mobile.png`。
- 已有会话桌面 1440px 与窄屏 390px：计算样式边框黑色、页面无横向溢出。模拟断线禁用发送并保留草稿，恢复后草稿不变，无脚本错误。
- 已有会话截图受浏览器窗口最小化限制，未完成视觉截图验收；重载后完成计算样式与断线检查。未做实体手机和真实中文输入法候选验收。本次只改颜色，不改输入流程。

## 跟随目标机器的新建项目

用户确认：浏览与创建目录跟随当前所选目标机器，本机连接使用本机目录，SSH 连接使用目标机器目录。

本轮只读生成本机配置指定 Codex 二进制的实际协议，输出 `/tmp/rcm-project-schema-9zr88G`，未更改安装文件。协议具有 `fs/readDirectory`、`fs/getMetadata`、`fs/createDirectory` 与 `project/create`。后者接收 name、roots、idempotencyKey。接口存在不代表已验证桌面同步。

继续只读核对当前安装 app.asar 的 `.vite/build/main-CLu1A25j.js`：

- `createLocal` 经目录确认、旧会话归属处理、项目后端写入，再更新桌面项目顺序与活动项目并广播。
- `writeAppServerProject` 调用原生 project/create 或 project/import，随后桌面 `cache.writeProject` 更新自身项目列表。
- `storeProject` 更新引擎 ID 映射；对桌面缓存不存在的普通项目，不直接补入桌面项目缓存。

与 `docs/sidebar-sync-research-2026-10-18.md` 的独立网页接入限制一致。本轮未找到可供 RCM 调用的完整桌面项目创建服务，不能将引擎 project/create 的回执等同于桌面项目可见。本次没有发布目录浏览或新建项目入口，没有创建测试项目或改写 Codex 项目状态。目录创建与项目登记需求仍未完成，待取得并核验桌面同步入口。

## 部署

部署前正式版本为 `e08b6899944a2a520e4a92a145ca6bef8e09799c`。部署结果后续补录。
