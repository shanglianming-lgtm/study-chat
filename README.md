# 书房 Chat

一间安静的书房，一本与你一起写成的书。Tauri 2 + React + Vite + TypeScript 的 Windows 桌面交互原型。**不部署、不调用真实模型、无需 API key。**

## Windows 准备

- Windows 10 / 11，推荐 PowerShell 7。
- [Node.js 22 LTS](https://nodejs.org/) 和 pnpm 10.11（可运行 `npm install -g pnpm@10.11.0`）。
- **仅桌面入口需要**：[Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，选择「使用 C++ 的桌面开发」，安装 MSVC 和 Windows 10/11 SDK。必须等待安装器显示安装完成，再打开新 PowerShell；可使用「Developer PowerShell for VS 2022」。否则可能误用 Git 的 `link.exe`，导致 Rust 链接失败。
- **仅桌面入口需要**：[Rust stable / rustup](https://www.rust-lang.org/tools/install)，使用默认的 `stable-msvc` 工具链。
- **仅桌面入口需要**：[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。Windows 11 通常已内置，仍需确认可用。
- 安装工具链后重新打开 PowerShell，确保 `node --version`、`pnpm --version`、`rustc --version` 可用。详见 [Tauri 官方 Windows 依赖说明](https://v2.tauri.app/start/prerequisites/#windows)。

```powershell
git clone https://github.com/shanglianming-lgtm/study-chat.git
Set-Location study-chat
# 切到本 PR 的分支后：
pnpm install --frozen-lockfile
```

### 可选入口一：网页预览

```powershell
pnpm dev
```

浏览器访问终端显示的 `http://localhost:1420`。不需要 Rust、Visual Studio 或 WebView2 开发工具。与桌面入口使用同一套前端，不是单独的演示页面。

### 可选入口二：Windows 独立桌面窗口

```powershell
pnpm tauri dev
```

此命令自动启动 Vite，然后打开独立窗口。**不要同时运行另一个 `pnpm dev`**，两者使用同一个固定端口 1420。首次 Rust 编译需要下载依赖，耗时较长。此版本不生成安装包，`bundle.active` 为 `false`。

## 如何试用

1. 点击书架上《与自己的漫长对话》的书脊，或「取下这本书」。
2. 翻阅封面、序章、版权页、目录和两章示例正文。方向键或底部按钮翻页；窄窗自动使用单页。
3. 输入问题，Enter 发送，Shift+Enter 换行；中文输入法选词的 Enter 不发送。文本框随草稿增高。
4. 模拟回应逐步出现在可滚动的手稿纸上，流式期间不将未完成回答分页。可随时「停笔」，现有部分仍装订。
5. 完成后自动跳到新回答开头。在「目录」中点击该轮提问或回答可返回，不依赖写死页码。
6. 「书页 / 速记」共享对话、输入草稿、模型和推理强度。模型和强度仅影响模拟标签，不代表真实推理。
7. 点击左上合书按钮，回到书架；当前窗口内重新取书可继续阅读。

## 实现边界

- 书房是 Three.js 实时三维场景：房间、窗框、书架、书桌、椅子、台灯、植物和书都由本地几何体建模，具有真实透视、灯光和阴影；无外部模型或在线贴图。拖动观察、滚轮缩放，点击带书名的书脊取书。
- 同一本带铰链封面的 3D 书从书架取出，移到桌面摊开，再进入可读的 HTML 书页；合上后逆向归架。尊重 `prefers-reduced-motion`，减少动态效果时直接切换。无 WebGL 时显示可用的取书入口，不阻断阅读和对话。
- 暖白纸色、本地打包的 Noto Serif SC（宋体回退）、镜像边距与实际页码。按真实 DOM 测量分页；长段落和代码可跨页，片段保留链接与内联标记。窗口或字体就绪时重新排版，导航目标保留章节 / 消息 ID。
- Markdown 支持段落、标题、列表、代码、链接；DOMPurify 限制标签和属性。不加载 Markdown 图片，防止粘贴内容触发远程资源。流式未闭合围栏按纯文本显示。
- 仅主动点击 HTTP(S) 正文链接时打开浏览器；Tauri 使用受限 opener capability，网页使用新标签页。不会自动访问输入的网址、抓取网页或读取浏览器登录态。「演示」来源卡不是检索结果。
- 所有文字、对话和草稿只在内存中，刷新 / 关闭会重置；不使用数据库、localStorage、登录、记忆、真实模型、天气、音乐或卷纸物理。
- 中文字体随前端一起打包，不依赖 Google Fonts 或其他 CDN。首次安装依赖仍需网络。

## 检查

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Vitest 覆盖 Markdown 消毒、未闭合围栏、HTTP(S) 校验、IME 发送规则、翻页边界、稳定 ID、跨页内容 / 链接 / 代码保留及尺寸变化。真实浏览器另验主流程及排版；jsdom 的分页测试使用明确的测量替身，不声称代替真实排版引擎。

GitHub Actions 运行前端类型、测试和构建检查。仓库没有预提交钩子。

## Windows 验证范围

Windows Server 2022 / WebView2 157 / Microsoft Pinyin 测试已确认：清理 Rust 构建产物后，`pnpm tauri dev` 完成编译并打开独立窗口；宽屏双页和 388px 单页无横向滚动；粘贴 URL 不访问，点击 HTTPS 链接由 Edge 打开；输入法组合期间 Enter 不误发，Shift+Enter 换行；停笔、装订、目录跳转、书页／速记切换和方向键可用。仓库包含所需 ICO，开发生成的 `src-tauri/gen/` schema 已忽略。

这些 Windows 结果来自三维书房加入之前的版本；原取还书动效的减少动态效果设置已验证。新的三维场景和翻页动效仍需 Windows 复验。

**已知 Windows / WebView2 限制（未修复）**：首次使用微软拼音时，测试中出现过候选框落在屏幕左上角，或第一轮组合没有候选栏（文字仍组合在输入框内、Space 仍可确认）。拖动窗口不一定恢复；与 [WebView2 上游候选框定位问题](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5675)同类。**已实测的恢复方法：清空当前组合再输入一次，或按 Alt+Tab 切到其他应用再切回书房 Chat。** 恢复后候选框位于输入光标旁；应用切换恢复后，最大化、还原和再次调整大小仍正常。不能视为 IME 已修复；组合事件防误发与原生候选栏是不同的验证。尝试的启动隐藏／恢复窗口方案未能可靠修复首轮候选栏，反而造成约 150ms 闪烁，已移除；当前版本不做启动焦点切换。

以下项目**尚未完成 Windows 真机验收**：

- 从零安装 MSVC / Windows SDK / WebView2 的完整流程。
- DPI / 缩放和窗口尺寸变化。
- 新三维书房在 Windows WebView2 的渲染、交互、取还书和翻页动效／减少动态效果。
- 使用 Enter 确认候选词（该机器的微软拼音使用 Space 确认），以及其他输入法。

本版未生成或验证安装包、签名和自动更新。上述限制不影响 `pnpm dev` 网页入口试用。
