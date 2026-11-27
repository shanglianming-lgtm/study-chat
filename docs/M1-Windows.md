# M1 首条闭环：Windows 源码试运行

这是源码交付，不是安装包。本轮没有操作或实测 Windows；请把下面步骤当作待在你的机器验收的操作说明。

## 范围

- 从 Devin PR #1 基线 `c75b4d4bb9118526bfc14d85723056728866d7cf` 延续现有界面。
- 原生窗口默认真实对话；可配置一个 OpenAI-compatible 完整 endpoint 和 model，使用 Chat Completions SSE 文本流。
- 一个项目、一个连续对话；消息、流式检查点和草稿存 SQLite，重启继续这段对话。暂不做多项目管理。
- API key 由 Rust 使用 Windows 凭据管理器保存与读取，按完整 endpoint 隔离。WebView 仅在用户输入/提交时短暂持有 key；不会将它放入 SQLite、日志、导出、localStorage 或 IndexedDB。没有读取凭据原文的前端命令。
- Markdown 导出由原生文件保存对话框选择目标，包含消息、未完成状态和未发送草稿，不包含服务商配置或 key。
- 浏览器 `pnpm dev` 仍为本地模拟演示；没有 API 配置入口，不会从浏览器向服务商请求。原生窗口中的演示也和真实数据隔离。
- 不含另两种协议、记忆、工具、角色、新房间或安装包。

## 准备与启动

准备 Node.js 22 或更新版本、pnpm 10.11.0、Rust stable MSVC 工具链、Visual Studio 2022 Build Tools（C++ 桌面开发和 Windows SDK）、WebView2 Runtime。原型 README 中保留了原有依赖链接。

1. 将 ZIP 完整解压到桌面的独立目录，例如 `StudyChat-M1`。打开其中有 `package.json` 的 `study-chat-m1` 文件夹；不要覆盖旧项目。
2. 在该目录打开新的 PowerShell。确认 `node --version`、`pnpm --version`、`rustc --version`。
3. 安装并启动：

```powershell
npm install -g pnpm@10.11.0
pnpm install --frozen-lockfile
pnpm tauri dev
```

首次会下载/编译 Rust 依赖，需要网络。若 pnpm 提示 esbuild 构建脚本未批准，仅批准项目所需的 esbuild，再重试。若遇 Rust 链接器问题，用已安装 VS 的 Developer PowerShell，避免误用 Git 的 `link.exe`。

不要同时运行 `pnpm dev`；Tauri 会自动启动固定端口 1420 的 Vite。`pnpm dev` 单独运行只用于网页演示，无法验证原生聊天或凭据。

## 不用真实 key 的本机验收

在第二个 PowerShell 中，进入同一个源码目录，运行：

```powershell
node scripts/mock-provider.mjs
```

这个服务只监听 `127.0.0.1:8787`，不访问外网，不记录请求和凭据，返回合成中文。

在原生窗口右上角或书页底部打开「对话设置」：

- 关闭「本地演示」；
- 服务商名称：`本机验收`；
- 完整请求地址：`http://127.0.0.1:8787/v1/chat/completions`；
- 模型 ID：`synthetic`；
- 取消「使用 API key」，key 留空；保存。

沿原有房间流程进入书页（无 WebGL 时使用「取书阅读」），切到「速记纸」进行验收：

1. 输入一个合成问题，先切到书页再切回来，草稿应相同。
2. 点击「落笔」：逐步出现中文合成回应；完毕后问答出现在书中和目录里。
3. 输入一段未发送草稿。关闭应用，再运行 `pnpm tauri dev`，重新打开书：历史、当前对话和草稿应恢复。
4. 继续提问，合成回应中的历史消息数量应增加。
5. 点击「导出」，选本地 `.md` 文件，在文本编辑器查看两轮消息和未发送草稿。取消保存对话框不应报错或写文件。
6. 模型改为 `synthetic-slow`，发送后「停笔并装订」：部分文本保留并标记未完成；改回 `synthetic` 后继续提问。
7. 模型改为 `synthetic-fail`：中途断流后显示错误并保留收到的部分；改回 `synthetic` 可以继续。
8. 模型改为 `synthetic-auth`：应显示认证错误，不把服务商原始错误体显示出来。
9. 关闭本机测试服务，发送应出现连接错误。重新启动服务后可继续；没有自动重试或重复发送。

上述本机验收服务用于测试协议，不代表真实模型能力。

## 连接自己的服务商

在「对话设置」填写服务商提供的完整 HTTPS `/chat/completions` 地址与模型 ID。路径由用户明确填写，本版不自动添加或删除 `/v1`。勾选使用 key，仅在应用的密码框中输入自己的 key；不需要把 key 发到聊天中。

保存后输入框清空。更换 endpoint 不会自动携带旧 key；可在原地址设置下删除已保存凭据。系统凭据库不可用时会明确失败，不回退为明文。

请求仅发往保存的 endpoint；禁止 HTTP 重定向、禁用自动环境代理。HTTP 只允许 localhost/回环地址用于测试。暂不支持需要额外认证头、代理配置或非 Chat Completions 流式格式的服务商。

发送包含该对话的原始 user/assistant 历史（包括已保留的非空部分回应），不发送示例章节、演示消息、profile 或记忆页。尚无上下文压缩；长对话可能达到服务商限制。失败后可以继续提问或重新输入问题；本版不提供原地重新生成/分支。

## 数据与迁移

SQLite 位于 Tauri 的应用数据目录 `com.studychat.desktop` 下，文件名 `study-chat.sqlite3`。Windows 通常位于 `%APPDATA%\com.studychat.desktop`；请按实际 Tauri 运行目录核对。同一份源码移动到桌面不会改变 app identifier，因此会继续使用同一应用数据目录。

本版数据库是本地明文消息库，不提供数据库加密。源码 ZIP 不包含该数据库。若以后迁移已有聊天，请先关闭应用，再复制数据库及仍存在的 `-wal`/`-shm` 伴随文件；API key 不随数据库迁移，需在目标系统重新填写。当前只使用一个应用实例。

异常退出时，已经写入 SQLite 的流式片段会在下次打开时标记为 interrupted；尚未送达/尚未确认保存的内容不能保证恢复。导出采用同目录临时文件后替换，写入失败不先截断已有目标。

## 本轮验证与限制

已验证环境：Linux x86_64 / Node 24.22.3 / Rust 1.100.0。

- 前端锁文件安装、TypeScript、Vite 构建；原有 49 项测试及新增 6 项前端生命周期测试。
- Rust 独立核心含系统凭据适配器的编译；2 项 SSE 解析测试与 5 项真实回环 HTTP 集成测试。
- 回环测试覆盖完整流式、取消与下一轮、断流、401、重定向拒绝、SQLite 关闭重开、恢复标记、上下文续接、导出与合成凭据不落盘。
- 测试凭据库是隔离内存替身；没有使用真实 key，没有访问真实服务商。
- Linux Chromium 的网页演示：共同草稿、设置说明、流式、停笔、书页切换。此浏览器 WebGL 不可用，走原有降级入口。
- 完整 Linux Tauri 检查被缺少 GTK/WebKit 开发依赖阻塞（gobject-2.0 pkg-config 缺失），未运行原生 GUI。
- Windows 编译、WebView2 IPC、系统凭据库实际读写、原生文件对话框与真实服务商尚未实测；Mac 同样未测。不能把核心集成测试称为 Windows 桌面端到端验收。
- Vite 保留原型的大 chunk 警告；本轮未改房间、素材或渲染性能。

可复现检查：

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/chat-core/Cargo.toml --locked --features native-credentials
cargo check --manifest-path src-tauri/Cargo.toml --locked
```
