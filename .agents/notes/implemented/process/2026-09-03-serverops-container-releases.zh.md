# Agent Note: ServerOps 容器发布

Status: implemented

[English](2026-09-03-serverops-container-releases.md) | 中文

## 问题

源码更新与单独安装的宿主运行时可能对应不同代码，使发布管理器无法证明当前服务流量的具体版本。

## 决策

[容器配方](../../../../Dockerfile) 构建官方 Node/pnpm 源码，并打包 CLI（命令行界面）的生产依赖树。[镜像工作流](../../../../.github/workflows/serverops-image.yml) 在完整长度标签及 OCI 标签中标识 checkout 的 SHA。[部署参考](../../../../docker/README.zh.md) 将外部配置、agent 和工作区目录分配到 v2 逻辑挂载。

私有 [Web 载体](../../../../docker/runtime/package.json) 提供 CLI 及其仅沿 dependencies 遍历时缺少的 19 个必需工作区 peer。普通隔离布局的 `pnpm deploy --legacy --prod` 保留生产依赖图，不以宿主二进制或 Python 载体替代。两个 vendored 工具包使用 `workspace:*` override，确保已构建文件随依赖图复制，而不是链接到镜像外。

源码构建保留 ui-shuangwen，使用现有 client-test-runtime 快照 helper，将插件纳入客户端 TypeScript 聚合并记录锁文件 importer。手动开关组件保留行为，仅补齐缺少的双语文案键。两个组件均未被额外启用到默认 Web 组装中。

## 考虑过的替代方案

**复制宿主运行时。** 其字节并非来自工作流 checkout，因此镜像版本无法标识实际运行的实现。

**使用 Python SDK 载体。** 它的打包入口提供 JSON-RPC；自托管服务需要 Web CLI、前端和插件依赖。

## 影响

发布管理器可以将镜像字节绑定到源码，并独立保存数据。冻结安装、官方源码构建及打包 Web 的 HTTP 启动已在本地 macOS 通过。Linux 镜像及原生模块就绪、浏览器/API 流式行为与迁移仍是单独的未验证检查。现有 SDK 打包和 CLI 监听地址校验保持不变；私有拉取所需凭据仍由外部提供。
