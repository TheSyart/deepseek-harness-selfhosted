# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

`dsh --profile desktop` 的 Electron 桌面 bundle：把 [`dsh-web-app`](../web-app/README.zh.md) 表面适配为无端口桌面载体的补丁层，加上运行时胶水与 IPC 桥。该 profile 依序叠加 [`dsh-base`](../base/README.zh.md)、`dsh-web-app` 与本 bundle。

桌面表面完整复用 Web 表面的客户端花名册——全部 `dsh.client` UI 行、`modules` 图组合器、`connection`、`api-gateway`——只替换传输层：

- bundle 补丁禁用 `webserver`、`web-startup`、`web-runtime` 与 `client-hmr`，并移除 `connection` 行的 `webRuntime` 注入。
- `desktop-runtime`（包根）提供 **`webServer` 组合 facade**：桌面 profile 不提供 HTTP，但被挂载的 `modules` 与 `connection` node 半会把传输绑定到 `webServer`，因此 facade 以空操作席位接受它们的路由注册。`host` 报告回环绑定（目录选择器解析器读取它并选择原生选择器），`port` 响亮报错，因为并不存在服务器。它同时注册模型可见的 `app:desktop-surface` prompt 片段。
- `desktop-bridge`（`./bridge`）通过 Electron `ipcMain` 通道为渲染端服务——`/api` 形态的 fetch（单向 RPC 加 apiproxy SSE 编解码下行流）、插件 bundle 与客户端 boot 图——由桌面应用装配提供的 `desktopStartup` 服务门控；纯 Node 下该行自我禁用。

Electron 窗口、preload 与渲染端入口位于 [`apps/desktop`](../../../apps/desktop/README.zh.md)，它持有 `electron` 依赖与 `desktopStartup` 提供者。

## 模型体验

### `app:desktop-surface` prompt 片段

#### 模型看到的内容

片段在每次请求组装时加入每个会话的系统提示，指明交互表面是桌面应用，并说明其传输是无 HTTP 端口的进程内 IPC 桥。

#### Token 影响

片段文本固定、与请求无关；它与 Web 表面的 `app:web-surface` 片段一样，每次系统提示贡献一个恒定块。

#### KV Cache 影响

片段文本不随请求变化，因此同一会话内复用完全相同的系统提示前缀 token；除普通系统提示外无额外每请求 KV 缓存开销。

## 已知限制与后续工作

- **Fetch 请求体以一次结构化克隆拷贝穿过 Electron IPC**——大附件 POST 会在传输时复制一份到内存；分块上传路径可降低常驻上限。
- **IPC 桥上没有客户端插件 HMR**——`client-hmr` 行保持禁用；配置级 `cordis.patch.yml` 热重载仍通过应用的启动 watcher 生效。
- **facade 的 `port` 读取会抛错**——真正需要服务器端口的行应改挂真实的 webserver 行；桌面各行从不读取它。
