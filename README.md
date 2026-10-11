# ChatGPT Card to PPTX

一个 Tampermonkey 用户脚本：在 ChatGPT 页面点选卡片或其他 DOM 区域，导出为可编辑的 PowerPoint 文件。

## 功能

- 鼠标悬停高亮区域，点击选中；优先选择 `data-d-component="box"`。
- 扩大到父级、缩回一级，按 Esc 取消选择。
- 普通文字和形状导出为 PPT 元素，SVG 保留矢量。
- 导出文件中的文字及主题字体统一为 **Microsoft YaHei UI**。
- 可选择是否包含 `::before` / `::after` 装饰，默认关闭。
- 显示导出阶段，转换超过 30 秒提示超时。
- 修正 JSZip 在用户脚本代理环境中的消息调度兼容问题。

## 安装

1. 在 Chrome 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开 `chrome://extensions/`，进入 Tampermonkey 的详情，开启“允许用户脚本”，并允许访问 `chatgpt.com`。旧版本 Chrome 可按 Tampermonkey 提示启用开发者模式。
3. 点击 [安装用户脚本](https://raw.githubusercontent.com/Notte118/ChatGPT-Card-to-PPTX/main/chatgpt-card-export.user.js)，在 Tampermonkey 界面确认安装。如果显示源码，则新建脚本，将模板全部替换为 [`chatgpt-card-export.user.js`](./chatgpt-card-export.user.js) 的内容，保存。
4. 刷新 ChatGPT 页面，右下角应出现工具面板。

只安装 `.user.js` 文件。`check` 开头的文件是开发检查，不需要添加到 Tampermonkey。

依赖通过固定版本的 `@require` 获取并由 Tampermonkey 缓存。首次安装需要能够访问 jsDelivr。

## 使用

1. 打开任意 `https://chatgpt.com/` 对话，等待回复生成完成。
2. 点击“选择区域”，鼠标移动查看蓝框，点击目标卡片。
3. 按需使用“扩大到父级”或“缩回一级”调整范围。
4. 点击“导出 PPTX”，从 Chrome 下载列表打开文件。

“装饰”开关只控制 CSS 伪元素。普通文字、背景、边框、圆角和 SVG 不受它影响。复杂装饰可能需要截图，建议先保持关闭。

## 转换范围

- 导出依赖浏览器中已经渲染的 DOM；页面外观与 PPT 可能存在差异。
- 图片和 Canvas 内容仍是图片，不能编辑其中的文字；SVG 可在支持的 PowerPoint 版本中转换为形状。
- SVG 内部的字体、图片中的文字不属于 PPT 文本字体统一的范围。
- 字体不嵌入文件；打开 PPT 的电脑应安装 Microsoft YaHei UI。
- 超时提示不会终止转换库内部任务；发生超时后请刷新页面再重试。
- 工具本身没有上传聊天内容的逻辑；转换库在处理图片等资源时可能加载它们的原始 URL。

## 本地检查

需要 Node.js，无需安装 npm 依赖：

```powershell
node .\check.cjs
```

调度及字体检查需要先下载固定版本的转换包到当前目录：

```powershell
Invoke-WebRequest 'https://cdn.jsdelivr.net/npm/dom-to-pptx@2.1.2/dist/dom-to-pptx.bundle.js' -OutFile '.\dom-to-pptx.bundle.js'
node .\check-scheduler.cjs
```

这些检查验证脚本状态及 ZIP 处理逻辑；浏览器集成仍需在 Chrome/Tampermonkey 中检查。

## 依赖与许可

本项目采用 [MIT License](./LICENSE)。第三方依赖保持各自的许可：

- [dom-to-pptx](https://github.com/atharva9167j/dom-to-pptx)，固定版本 2.1.2，MIT License。
- [JSZip](https://github.com/Stuk/jszip)，固定版本 3.10.1，采用其 MIT 许可选项。

本项目是独立的社区工具，与 OpenAI/ChatGPT 无隶属关系。
