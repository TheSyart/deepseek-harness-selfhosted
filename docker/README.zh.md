# 自托管镜像参考

[English](README.md) | 中文

[Dockerfile](../Dockerfile) 在 Linux 上使用 Node 24.19.0 和 pnpm 11.7.0 构建 Node/pnpm 源码，执行官方客户端构建，并通过 `pnpm deploy --legacy --prod` 打包 CLI（命令行界面）的生产依赖树。运行时启动打包后的 `lib/bin.js --profile web --patch /app/container.patch.yml --no-open`。它不读取宿主机安装或 Python SDK 运行时。

## 运行时与持久化

[容器覆盖配置](container.patch.yml) 将现有 webserver 插件配置为监听 0.0.0.0:3080。CLI 对 `--host` 选项的限制保持不变。`DSH_TRUSTED_HOSTS` 包含逗号分隔的公开 authority，供现有浏览器信任检查使用。外部 HTTPS 代理保留 Host、Origin、WebSocket 和 SSE（Server-Sent Events），关闭流缓冲并负责认证；宿主机只发布回环端口。

[v2 manifest（元数据清单）](../.serverops/service.json) 声明三个逻辑挂载：`config` 对应 `/app/data/config`（完整的 `DSH_HOME`，包含设置、配置档、会话和存储），`agents` 对应 `/app/data/agents`（共享 agent 配置），`workspace` 对应 `/app/data/workspace`（工作目录）。迁移时保留每个完整目录及其现有凭据。切换前核对存储的绝对工作区路径与新容器路径；镜像不改写会话，也不初始化替代数据。绑定目录必须已存在，并对配置的非 root UID/GID 可写。

将 [compose.env.example](compose.env.example) 和 [runtime.env.example](runtime.env.example) 复制到不同的外部文件，填入已验证的镜像 digest、路径和运行时凭据。[Compose](../compose.production.yml) 是可审查的样例；ServerOps 根据 root 批准的策略生成生产 Compose，不以 root 执行仓库文件。进程配置了 init、自动重启和 10m × 3 的 JSON 日志轮转。

## 镜像发布与检查

[工作流](../.github/workflows/serverops-image.yml) 在 master 推送及手动触发时构建私有 GHCR 的 `linux/amd64` 镜像。可选 `commit` 指定完整的小写 40 位 SHA。运行名称包含请求的 SHA；标签和 OCI revision/source 使用实际 checkout。CI 仅有 contents:read 和 packages:write，不执行部署。GHCR 包必须保持 private；ServerOps 将带有包读取权限的私有拉取凭据保存为 `ghcr.token`，放在仓库和镜像之外。

迁移前必须通过冻结依赖安装、官方构建、打包 CLI 和前端检查、Linux 容器 `/` 就绪检查、浏览器/API/SSE 检查以及备份/回滚验证。源码快照存在构建阻塞：锁文件缺少 `packages/client/ui-shuangwen`，且它引用了不存在的工作区包 `@deepseek-ai/dsh-client-web-react`。在该源码依赖修复之前，构建配方会在冻结安装阶段失败；本次适配尚未验证 Linux 打包或就绪状态。

现有宿主机运行时 `/opt/deepseek-harness/runtime` 是独立版本。本镜像仅使用 `/app/runtime` 内从源码构建的产物；宿主数据迁移与版本切换由 ServerOps 负责。不涉及已安装的 macOS 应用。[决策记录](../.agents/notes/implemented/process/2026-09-03-serverops-container-releases.zh.md) 解释了打包选择与验证限制。
