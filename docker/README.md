# Self-hosted image reference

English | [中文](README.zh.md)

The [Dockerfile](../Dockerfile) builds the Node/pnpm source on Linux using Node 24.19.0 and pnpm 11.7.0, runs the official client build, and packages the CLI's production dependency tree with `pnpm deploy --legacy --prod`. The runtime launches the packaged `lib/bin.js --profile web --patch /app/container.patch.yml --no-open`. It does not consume a host installation or the Python SDK runtime.

## Runtime and persistence

The [container overlay](container.patch.yml) configures the existing webserver plugin to bind 0.0.0.0:3080. The CLI's restricted `--host` option is not changed. `DSH_TRUSTED_HOSTS` contains comma-separated public authorities for the existing browser trust checks. The external HTTPS proxy preserves Host, Origin, WebSockets and SSE, disables stream buffering, and owns authentication; only the host's loopback port is published.

The [v2 manifest](../.serverops/service.json) declares three logical mounts: `config` at `/app/data/config` (the complete `DSH_HOME`, including settings, profiles, sessions and storages), `agents` at `/app/data/agents` (shared agent configuration), and `workspace` at `/app/data/workspace` (the working directory). Preserve each complete directory and its existing secrets during migration. Validate stored absolute workspace paths against the new container path before switching; the image does not rewrite sessions or seed replacement data. Bind directories must already exist and be writable by the configured non-root UID/GID.

Copy [compose.env.example](compose.env.example) and [runtime.env.example](runtime.env.example) to separate external files and fill in verified image digests, paths and runtime credentials. [Compose](../compose.production.yml) is a reviewable example; ServerOps generates production Compose from root-approved policy instead of executing the repository file as root. The process has init, restart and 10m × 3 JSON log rotation.

## Image publication and checks

The [workflow](../.github/workflows/serverops-image.yml) builds private GHCR `linux/amd64` images on master pushes and manual dispatch. An optional `commit` selects an exact lowercase 40-character SHA. The run name includes that requested SHA; the tag and OCI revision/source use the actual checkout. CI has only contents:read and packages:write and does not deploy. GHCR packages must remain private; ServerOps stores the private pull credential as `ghcr.token` with package read access, outside the repository and image.

Before migration, require a successful frozen install, official build, packaged CLI and frontend checks, Linux container readiness at `/`, browser/API/SSE checks, and backup/rollback verification. The source snapshot contains a build blocker: `packages/client/ui-shuangwen` is absent from the lockfile and references the missing workspace package `@deepseek-ai/dsh-client-web-react`. The recipe deliberately fails its frozen install until that source dependency is repaired; neither Linux packaging nor readiness is established by this adaptation.

The existing host runtime at `/opt/deepseek-harness/runtime` is a separate release. This image uses only its source-built payload at `/app/runtime`; host data migration and release switching belong to ServerOps. No installed macOS application is involved. The [decision record](../.agents/notes/implemented/process/2026-09-03-serverops-container-releases.md) explains the packaging choice and verification limits.
