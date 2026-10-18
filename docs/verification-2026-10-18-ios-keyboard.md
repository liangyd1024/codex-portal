# 手机键盘输入设置核查（2026-10-18）

截图中的上下箭头与完成勾是 iOS 表单辅助栏，钥匙、银行卡与定位是 Safari 自动填充入口。消息框原为原生 textarea，并无 password、numeric 或错误 inputmode 设置。依据既有 mobile/new-chat 验收记录保留原生编辑器和中文输入保护，未声称与 Codex 原生键盘外观一致。

本次只修改 public/index.html：消息表单和消息框声明 autocomplete=off，消息框明确 inputmode=text、enterkeyhint=enter；新会话与既有会话共用同一输入框。不会改用户的系统九宫格输入法，也不改变手机 Enter 换行逻辑。

Apple 官方说明 Safari 可能忽略 autocomplete=off：https://developer.apple.com/documentation/safari-developer-tools/autofill 。此改动是输入语义补齐，不能保证移除系统辅助栏或自动填充入口，不能将其记录为截图问题完全修复。

## 验证

- npm test 已执行两次，首次测试证书生成超时；第二次 HTTP 路由及证书测试超时。改用 node --test --test-concurrency=1 test/*.test.mjs，154 项全部通过。Python 结果另补。
- ego-browser 空间 86，4327、RCM_MOBILE=0、全新临时状态目录隔离预览；新会话只编辑草稿，没有发送/创建引擎会话。
- 输入框属性在浏览器中正确读取；模拟 composition Enter 未提交且草稿保留；桌面 Tab 到更多输入工具，焦点轮廓 solid。
- 桌面 1440×900 与手机模拟 390×844 均无横向溢出；390px 输入框 x=25..365，发送按钮 x=317..365。截图 /tmp/rcm-keyboard-desktop.png、/tmp/rcm-keyboard-mobile.png 已查看。
- 未测：实体 iPhone Safari 系统辅助栏、真实中文候选窗、听写与键盘升降。本次无发送逻辑或异步状态改动。

## 交付状态

本次改动单独提交，其他会话的 manager、app、composer、mobile-ui 与测试修改原样保留。正式基线 c89493ace9769e1f0ca6ea67671c00a28d279fd7 已包含在当前 master；有其他会话未提交改动时安装器拒绝部署，不能把预览记作正式上线。
