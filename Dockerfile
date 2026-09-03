# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /source
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@11.7.0
ENV CI=true
COPY . .
ARG SOURCE_COMMIT
# The source archive excludes .git; only this public revision is passed to the client build.
RUN test -n "$SOURCE_COMMIT" \
    && DSH_CLIENT_COMMIT_HASH="$SOURCE_COMMIT" pnpm install --frozen-lockfile \
    && DSH_CLIENT_COMMIT_HASH="$SOURCE_COMMIT" pnpm run build:official
# pnpm selects package files and closes workspace dependencies, including the Web frontend.
RUN pnpm --filter dsh-web-runtime-pkg deploy --legacy --prod /out \
    && node /out/node_modules/@deepseek-ai/dsh/lib/bin.js --version \
    && node /out/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --help \
    && node -e "const {createRequire}=require('node:module'); const carrier=createRequire('/out/package.json'); const cli=createRequire(carrier.resolve('@deepseek-ai/dsh/package.json')); const web=createRequire(cli.resolve('@deepseek-ai/dsh-web-app')); require('node:fs').accessSync(web.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))"

FROM node:24.19.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/runtime
COPY --from=build /out/ ./
COPY docker/container.patch.yml /app/container.patch.yml
ENV NODE_ENV=production DSH_HOME=/app/data/config \
    DSH_AGENTS_HOME=/app/data/agents DSH_TELEMETRY_DISABLED=1
RUN mkdir -p /app/data/config /app/data/agents /app/data/workspace \
    && chown -R node:node /app/data
WORKDIR /app/data/workspace
USER node
EXPOSE 3080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "/app/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js", "--profile", "web", "--patch", "/app/container.patch.yml", "--no-open"]
