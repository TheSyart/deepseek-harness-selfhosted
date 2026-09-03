# Agent Note: ServerOps 容器发布

Status: implemented

[English](2026-09-03-serverops-container-releases.md) | 中文

## 问题

源码更新与单独安装的宿主运行时可能对应不同代码，使发布管理器无法证明当前服务流量的具体版本。

## 决策

[容器配方](../../../../Dockerfile) 构建官方 Node/pnpm 源码，并打包 CLI（命令行界面）的生产依赖树。[镜像工作流](../../../../.github/workflows/serverops-image.yml) 在完整长度标签及 OCI 标签中标识 checkout 的 SHA。[部署参考](../../../../docker/README.zh.md) 将外部配置、agent 和工作区目录分配到 v2 逻辑挂载。

## 考虑过的替代方案

**复制宿主运行时。** 其字节并非来自工作流 checkout，因此镜像版本无法标识实际运行的实现。

**使用 Python SDK 载体。** 它的打包入口提供 JSON-RPC；自托管服务需要 Web CLI、前端和插件依赖。

## 影响

发布管理器可以将镜像字节绑定到源码，并独立保存数据。镜像构建会因现有的 ui-shuangwen 工作区依赖缺失而失败，不会替换为宿主二进制。冻结安装、打包启动和真实 Linux 就绪检查仍是必要检查；不声称容器运行时已通过验证。现有 SDK 打包和 CLI 监听地址校验保持不变。
