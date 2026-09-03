# Self-hosted image reference

English | [中文](README.zh.md)

The [Dockerfile](../Dockerfile) builds the Node/pnpm source on Linux using Node 24.19.0 and pnpm 11.7.0, runs the official client build, and packages the private [Web carrier](runtime/package.json) with `pnpm --filter dsh-web-runtime-pkg deploy --legacy --prod`. The carrier includes the CLI and the required workspace peers of its production plugin graph. Vendored cosmokit and schemastery use `workspace:*` overrides so deployment copies their built payloads instead of leaving source-tree links. The runtime launches `/app/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --patch /app/container.patch.yml --no-open`. It does not consume a host installation or the Python SDK runtime.

## Runtime and persistence

The [container overlay](container.patch.yml) configures the existing webserver plugin to bind 0.0.0.0:3080. The CLI's restricted `--host` option is not changed. `DSH_TRUSTED_HOSTS` contains comma-separated public authorities for the existing browser trust checks. The external HTTPS proxy preserves Host, Origin, WebSockets and SSE, disables stream buffering, and owns authentication; only the host's loopback port is published.

The [v2 manifest](../.serverops/service.json) declares three logical mounts: `config` at `/app/data/config` (the complete `DSH_HOME`, including settings, profiles, sessions and storages), `agents` at `/app/data/agents` (shared agent configuration), and `workspace` at `/app/data/workspace` (the working directory). Preserve each complete directory and its existing secrets during migration. Validate stored absolute workspace paths against the new container path before switching; the image does not rewrite sessions or seed replacement data. Bind directories must already exist and be writable by the configured non-root UID/GID.

Copy [compose.env.example](compose.env.example) and [runtime.env.example](runtime.env.example) to separate external files and fill in verified image digests, paths and runtime credentials. [Compose](../compose.production.yml) is a reviewable example; ServerOps generates production Compose from root-approved policy instead of executing the repository file as root. The process has init, restart and 10m × 3 JSON log rotation.

## Image publication and checks

The [workflow](../.github/workflows/serverops-image.yml) builds private GHCR `linux/amd64` images on master pushes and manual dispatch. An optional `commit` selects an exact lowercase 40-character SHA. The run name includes that requested SHA; the tag and OCI revision/source use the actual checkout. CI has only contents:read and packages:write and does not deploy. GHCR packages must remain private; ServerOps stores the private pull credential as `ghcr.token` with package read access, outside the repository and image.

Frozen install, official source build, packaged CLI version/help, frontend resolution and isolated packaged Web startup have passed locally on macOS with Node 24.19.0. The smoke checked `/` and its four initial static resources and a clean shutdown without a model call. This is not Linux container or browser-interaction evidence. The macOS package omits the two optional Linux Landlock variants; its unused pnpm carrier self-alias is dangling, while the other checked links remain within the payload.

Before migration, require the exact-SHA Linux image build, native PTY/Landlock checks, container readiness at `/`, browser/API/WebSocket/SSE checks, and backup/rollback verification. Private pulls require an external `ghcr.token` with `read:packages`; image publication alone does not change the production service or establish migration readiness.

The existing host runtime at `/opt/deepseek-harness/runtime` is a separate release. This image uses only its source-built payload at `/app/runtime`; host data migration and release switching belong to ServerOps. No installed macOS application is involved. The [decision record](../.agents/notes/implemented/process/2026-09-03-serverops-container-releases.md) explains the packaging choice and verification limits.
