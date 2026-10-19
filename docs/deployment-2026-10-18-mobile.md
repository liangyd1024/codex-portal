# 手机优化正式部署记录（2026-10-18）

- 正式部署版本：`ab2ffc27070f378d1f30bdbfb7f4bbda6f5e617d`。
- 上一正式版本：`dbb45bd187c898b1d2db2134ad7eb7ebcf796e8c`。
- 安装完成：`2026-10-18T05:01:31.535Z`（UTC）。
- 发布分支：`codex/deploy-mobile-ui`；原开发目录及其未提交修改保留。
- 不可变版本目录：`/Users/marco/Library/Application Support/RemoteCodexManager/releases/ab2ffc27070f378d1f30bdbfb7f4bbda6f5e617d`。
- 部署前加密备份：`/Users/marco/Library/Application Support/RemoteCodexManager/backups/marco-20261018T050126747763Z.tar.gz.age`（1,199,402 字节）。
- 上一网页服务配置：`/Users/marco/Library/Application Support/RemoteCodexManager/install-history/1792299687930.plist`。

按仓库 `node scripts/install-local.mjs --ref ab2ffc2` 安装，空闲检查、加密备份、健康检查通过，未触发回退。只重启本机网页服务，没有停止目标引擎；本机引擎 PID 26281 与部署前一致，5 秒释放设置保持。

## 验证结果

- `/api/version` 返回上述完整提交；6 个新增或修改的前端资源与安装目录逐字节一致。
- `npm test`：72 项 Node、23 项 Python 测试通过；发布整合和浏览器模拟证据见 [发布验收](release-mobile-2026-10-18.md)。
- ego-browser 390px 访问真实正式页面，未注入模拟 API；页面加载成功，本机连接正常，手机更多菜单和抽屉可用。
- `https://192.168.1.14:4319/` 与 `/mobile-ui.css` 均返回 200；使用配置 CA 验证 TLS，没有跳过证书验证。未配对请求仍显示配对页。
- 正式手机侧栏点击目标测量均不小于 44px，无横向溢出；打开抽屉时背景 inert 生效。
- 切换 Ally 的实际连接测试未通过：SSH 到配置目标的 22 端口超时，页面正确显示失败和重新连接入口；未修改 SSH 配置或停止远端任务。检查后网页切回本机连接。远程网络恢复前，此项不能标为通过。
- 原有 Tailscale 健康警告仍为 DNS 服务不可达；本机访问该 HTTPS 外网地址发生 TLS EOF，不能标为可用。此问题部署前已存在，本次未修改网络或配对配置。

## 手机验收

手机连接同一 Wi-Fi 后打开或刷新 [正式手机入口](https://192.168.1.14:4319)。已有配对登录无需主动退出；若会话已过期，沿用本机详情中的配对流程。

Safari 原生键盘、中文候选、缩放、锁屏恢复、文件下载与真实听写由用户真机继续验收。本次完成正式网页部署，不代表这些真机项已通过。
