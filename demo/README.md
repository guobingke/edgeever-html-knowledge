# 本地开发演示

运行 `npm run build`，再运行 `npm run dev`，打开 <http://127.0.0.1:4173/demo/>。

这是模拟宿主，不是 EdgeEver，也不连接任何账户。它加载真正的 `dist/main.js` Bundle，模拟 API v2 的命令、面板、嵌入块、笔记、附件 CAS 更新、事件和插件存储，以浏览器 `localStorage` 保存测试笔记和附件。测试数据仅保存在该本地站点。清理站点数据可重置。

本演示不验证 EdgeEver 实际安装、同步、桌面桥、离线更新限制、原生窗口生命周期以及宿主样式。笔记插入立即持久化是演示简化；真实宿主的 `insertEmbed` 只更新编辑器，仍应按宿主流程保存笔记。

开发服务器只绑定 `127.0.0.1:4173`，只读提供 `demo/`、`dist/` 的 HTML、JS、JSON、CSS，不提供项目源文件、依赖或任意文件路径。启用了 CORS，便于本地 Manifest 调试。最终分发只使用 `dist/manifest.json` 和 `dist/main.js`，不包含模拟宿主。

`npm run test:e2e` 使用 Chromium 执行真实 Bundle 的端到端测试。Windows 优先选择已安装的 Playwright headless shell；其他系统使用 Playwright 默认浏览器，需要事先安装。
