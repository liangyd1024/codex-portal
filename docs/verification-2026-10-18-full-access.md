# 网页固定完全访问与默认部署规则（2026-10-18）

## 行为

- 移除输入工具栏及新建会话表单的权限选择。网页新建会话、已有会话发送新轮次统一传入 `access: full`；旧 localStorage 权限偏好及旧 sessionStorage 中的 access 字段均不能覆盖。
- 执行/计划、目标、技能、插件入口保留；运行中补充沿用该轮启动时权限，其他 API 客户端的默认策略未改。
- AGENTS.md 和 README 已记录：功能修复验证通过后，默认提交并按标准流程部署本机正式网页，无需再次询问；保留空闲检查、加密备份、健康检查和失败回退。
- 本轮发布同时包含前一轮输入工具栏对齐、CSP 图片粘贴兼容和后台状态判断修复。

## 发布基线与隔离

当前正式版本 `7b27d4cb8688d018100e6eeec87d370bdb69c6b1`。从该版本建立发布工作树，只叠加本轮变更，保留正式版本已有的侧栏动作、排序通知、手机配对恢复等实现。原开发目录的其他未提交内容未打包发布。

预览配置为 `RCM_PORT=4327 RCM_MOBILE=0 RCM_STATE_DIR=/tmp/rcm-full-access-preview.kz3FXU`。Ego Lite TaskSpace 56，API/SSE 使用专用模拟连接 `qa-full-access`，静态资源与 CSP 使用真实发布候选服务。

## 验证

- 发布工作树 `npm test`：92 项 Node、24 项 Python 全通过，日志 `/tmp/rcm-full-access-release-tests-20261018.log`。包含已有权限参数测试及本轮后台状态回归。
- 预置旧 localStorage 权限为 default，sessionStorage 的旧选择也包含 access=default。计划模式的已有会话发送、新建会话请求、新会话发送均实测携带 access=full。
- 页面和新建表单均无权限选择控件；新建表单仅保留项目、模型、思考档位选择。新建成功后正常进入新会话，无浏览器异常。
- 1440px 桌面、390px 窄屏无横向溢出；手机执行模式、工具入口均为 44px 高。Tab 从模式直接进入工具，Enter 打开、Esc 关闭并返回焦点，焦点框可见。
- 合成中文 composition Enter 未触发消息发送。实体中文输入法、手机 Safari/Android 未验证；本轮新建和发送参数采用模拟接口，未再次向真实模型发消息。
- 图片原生剪贴板、失败保留与重试的验证见 [上一轮记录](verification-2026-10-18-composer-fix.md)。

截图：[桌面](composer-fix-evidence-2026-10-18/full-access-desktop.png)、[390px](composer-fix-evidence-2026-10-18/full-access-mobile.png)。正式部署结果另记部署文档。
