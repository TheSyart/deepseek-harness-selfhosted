# @deepseek-ai/dsh-desktop-app

[English](README.md) | 中文

`desktop` profile 之上的 Electron 桌面应用：启动该 profile 的主进程装配、把 IPC 桥暴露给渲染端的 preload，以及接好传输的渲染端入口。宿主侧桥与运行时胶水位于 [`@deepseek-ai/dsh-desktop`](../../packages/bundle/desktop/README.zh.md)；本应用持有 `electron` 依赖、窗口生命周期与 `desktopStartup` 提供者。

## 入口

| 入口 | 职责 |
|---|---|
| [`src/main.ts`](src/main.ts) | profile 启动（bundle 层、用户补丁、随附 preset、遥测开关、仅配置热重载）、带发送者围栏的 `desktopStartup` 提供者、单实例锁，以及经 fiber 卸载的退出 |
| [`src/preload.ts`](src/preload.ts) | 经 `contextBridge` 暴露 `window.__DSH_DESKTOP__`：boot 图、bundle 文本、fetch 传输、中止、流订阅 |
| [`src/renderer/transport.ts`](src/renderer/transport.ts) | IPC fetch（只有 `dsh.internal` URL 走桥）、`dsh-bundle://` bundle loader，以及 `window.__DSH_BOOT__` 安装 |

窗口以 `contextIsolation: true`、`sandbox: false` 经 `file://` 加载已构建的渲染端 dist；组合不监听 HTTP 端口。带发送者围栏的 IPC transport 会声明与 loopback 等价的本地权限，因此 file 页面使用 Host 持久化的用户设置，却不会把同样权限授予普通远程浏览器。开发运行先用 `pnpm --filter @deepseek-ai/dsh-desktop-app run build` 构建渲染端，再用 `pnpm --filter @deepseek-ai/dsh-desktop-app start` 启动。安装版产品载荷必须来自根目录的 `pnpm run build:official`，使动态客户端 bundle 带有官方标题、commit 元数据与 DeepSeek Harness 品牌 occupant。

## macOS 图标

[`resources/deepseek-harness.svg`](resources/deepseek-harness.svg)包含白色 1024 像素底板上的静态黑色 DeepSeek 鲸鱼。在 macOS 上，`pnpm --filter @deepseek-ai/dsh-desktop-app run build:icon` 使用 `sharp` 生成标准 PNG representation，再由 `iconutil` 生成随仓库提交的 `deepseek-harness.icns`。更新已安装的本地 App 时，须遵守[已安装桌面应用更新](../../AGENTS.md#installed-desktop-application-updates)中的备份、仅载荷暂存、签名与验证规则；只有获得单独授权时才替换图标。

## 已知限制与后续工作

- **没有客户端插件 HMR 通道**——桥只承载 RPC、下行流、bundle 与 boot 图；配置级 `cordis.patch.yml` 热重载仍经应用的启动 watcher 生效。
