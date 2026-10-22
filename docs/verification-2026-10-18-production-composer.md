# 正式网页版三项验收（2026-10-18）

## 结论与范围

正式页面 `http://127.0.0.1:4317` 使用 ego-browser TaskSpace 61 实测。样式、原生剪贴板图片、新建及发送固定完全访问均通过。最终验收版本为 `12bcbaa02f99180e7acd60e9decd3ed7c712b6b4`。

最终版本真实测试会话 `REDACTED-ID`，轮次 `REDACTED-ID`。页面没有 API fixture；只用透明 fetch 记录器保存请求参数与响应摘要，所有创建、发送及推理均由真实服务完成。

## 三项实测

- **样式**：发现桌面附图后 `.mention-input-wrap` 换行，底部操作区仍为自动宽度，导致发送按钮落到左侧。修复后附图操作行占满输入框宽度，添加图片在左、模型和发送在右。1440px 下输入框宽 880px，发送按钮右边缘距输入框右边缘 11px；390px 下输入框宽 366px，发送按钮 48×48px，底部位于 831px（视口高 844px）。两种尺寸均无横向溢出。
- **粘贴图片**：通过浏览器原生剪贴板写入 PNG，聚焦输入框并按 Cmd+V。缩略图、预览解码、Escape 关闭、移除均正常；无 CSP 违规或浏览器脚本错误。真实新会话首条消息包含转换后的 JPEG data URL。模型回复 `RCM–FINAL–4827，红色，WEB_FULL_ACCESS_FINAL_OK`，证明图片内容已到达模型。发送成功才清空草稿和图片。
- **完全访问**：新会话页面及输入区均无授权方式控件。新建请求 HTTP 201、首条发送 HTTP 200，均携带 `access: full`。从该轮原生 rollout 核对：`approval_policy: never`，`sandbox_policy.type: danger-full-access`。只读命令 `printf WEB_FULL_ACCESS_FINAL_OK` 退出码 0，全程无审批请求。

首次在 `b44e325` 上也完成真实识图与只读命令验证，会话为 `REDACTED-ID`。最终合并版本再次完整执行了上述新建与发送流程，未只依赖早期结果。

截图：最终桌面附图（含个人信息，截图已移除）、[最终 390px 附图](production-composer-evidence-2026-10-18/mobile-final.png)、新会话首条消息（含个人信息，截图已移除）、修复前按钮位置（含个人信息，截图已移除）。请求、布局和权限的脱敏摘要见 [checks.json](production-composer-evidence-2026-10-18/checks.json)。

## 并行发布与正式部署

样式修复提交为 `d871d54383e46301682b57e5c8bb45d5fdfd9d8a`。验收期间先后出现其他任务的 `004f9a8`（侧栏稳定性）及 `70983d6`（新会话草稿流程）发布；后者未包含前者及样式修复。因此在干净发布工作树中合并二者，生成最终 `12bcbaa02f99180e7acd60e9decd3ed7c712b6b4`，保留全部功能。

按标准命令 `node scripts/install-local.mjs --ref 12bcbaa02f99180e7acd60e9decd3ed7c712b6b4` 部署，空闲检查、加密备份和健康检查通过。备份：

`/Users/local-user/Library/Application Support/RemoteCodexManager/backups/MACHINE-TIMESTAMP.tar.gz.age`

正式 `/api/version` 返回最终提交，`app.js`、`composer.js`、`composer.css`、`attachments.js` 的实际响应 SHA-256 与提交源码一致。未改写已安装 release；未停止目标引擎或其他任务。

## 回归、模拟与限制

- 合并后的 `npm test`：103 项 Node、24 项 Python 全部通过；`git diff --check` 通过。日志 `/tmp/rcm-production-composer-merged-tests-20261018.log`。
- CSS 候选阶段规定的 4327 已被另一个任务占用，未停止该进程。TaskSpace 61 的 p2 使用 fixture API 与浏览器 CSS 覆盖检查候选布局和键盘焦点；这一段属于模拟验证。p1 最终正式页验收没有 fixture 或 CSS 覆盖。
- 390px 是 Chromium 视口模拟，未验证实体手机、Safari 或实体中文输入法；此前中文 composition 模拟结果见既有验收记录。
- 并行发布重连及模型运行期间出现目标状态读取超时，界面曾显示“后台命令状态待确认”。这是仍可复现的独立状态读取问题，不能据此称整个网页完全无异常；本轮未修复其根因。最后单独读取真实服务确认测试会话 `idle`、后台命令列表为空、待审批为空、goalError 为空。页面没有“后台命令仍在运行”，停止按钮隐藏。
- 旧测试会话在重启恢复订阅时曾出现 active writer 提示，其他历史订阅出现缺失或归档提示；未为消除这些提示而停止服务或修改旧会话。
- 已清空最终测试草稿与附件并关闭整个验收浏览器空间；没有本轮遗留的预览服务或运行任务。

## 交付前的后续发布

浏览器空间关闭后，其他任务继续发布了 `2ed04c8`（用户消息气泡样式）及 `8b27bc926722da3dd497371923a9ada8a1421008`（模型目录超时及并发读取）。本轮没有为追逐并行发布而重启或再次部署。最后一次 HTTP 资源核对中，当前正式版的 `composer.css`、`composer.js`、`attachments.js`、`app.js` 均与浏览器实测的 `12bcbaa` 完全相同。本记录的真实浏览器截图和端到端结论对应 `12bcbaa`；后续版本未重新进行完整浏览器验收，状态超时也未在后续版本复核。
