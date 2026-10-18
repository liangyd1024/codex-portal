# 桌面端新建会话：工作空间设置加载失败排查

## 结论与边界

截图提示来自 Codex 桌面端账号／工作空间权限检查。现有证据指向桌面端访问 ChatGPT 的网络链路失败，没有证据证明本次新建会话失败由 RCM 网页版占用会话引起。尚未完成桌面端重试验收，不应标记已修复。

## 本机证据

- 2026-10-18 18:50 后（北京时间）的桌面日志中，51 次本地 config/read、configRequirements/read、permissionProfile/list 请求 errorCode=null。
- 同期 /accounts/check/{version}、/accounts/verified_access、/settings/user 等接口多次 ERR_CONNECTION_CLOSED。日志的 status=500 与网络异常一起出现，不能据此判断服务端返回了 HTTP 500。
- 只读核对桌面安装包：workspacePolicy.loadError.title 对应截图，账号检查或工作空间策略加载失败时显示；重试会重新加载相关查询。
- macOS scutil --proxy：HTTP、HTTPS、SOCKS、PAC 均关闭。Clash Verge 配置：TUN 开启，系统代理关闭，mixed-port=7897。
- 不携带登录信息的 HTTPS 探测：直连 ChatGPT 的两个路径均在 6 秒 TLS 连接超时；通过 http://127.0.0.1:7897 访问，TLS 验证成功，分别收到 HTTP 401、403。后者仅证明代理可达，不证明已登录设置接口成功。
- 当前 RCM 发布版本 7b27d4cb8688d018100e6eeec87d370bdb69c6b1 的相关代码未发现写入 Codex config.toml 或桌面账号设置的逻辑。会话 active writer 冲突有独立的 WRITER_CONFLICT 提示，不等同于本次错误。

## 修复候选与验收

经用户确认后开启现有 Clash 的系统代理，再在桌面新建会话页面点击“重试”。不修改 Codex 登录、权限策略或安装包，不停止正在运行的会话。

验收应同时检查提示消失、输入可用，以及同一时间段账号设置请求不再出现网络错误。原生 UI 工具禁止操作 com.openai.codex，桌面重试需用户执行；没有尝试绕过工具限制。

本次尚未变更应用代码或部署新版本。系统代理会影响其他遵循系统代理的应用，因此已询问用户确认，等待答复。
