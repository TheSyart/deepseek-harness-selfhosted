# Agent Note: ServerOps container releases

Status: implemented

English | [中文](2026-09-03-serverops-container-releases.zh.md)

## Problem

Source updates and a separately installed host runtime can identify different code, preventing a release manager from proving which revision is serving traffic.

## Decision

The [container recipe](../../../../Dockerfile) builds the official Node/pnpm source and packages the CLI's production dependency tree. The [image workflow](../../../../.github/workflows/serverops-image.yml) identifies the checked-out SHA in immutable-length tags and OCI labels. The [deployment reference](../../../../docker/README.md) assigns external config, agent and workspace directories to symbolic v2 mounts.

The private [Web carrier](../../../../docker/runtime/package.json) supplies the CLI and the 19 required workspace peers missing from its dependency-only closure. Ordinary isolated `pnpm deploy --legacy --prod` retains the production graph; no host binary or Python carrier replaces it. `workspace:*` overrides for the two vendored utility packages ensure their built files travel with the graph instead of linking outside the image.

The source build retains ui-shuangwen, uses the existing client-test-runtime snapshot helper, includes the plugin in the client TypeScript aggregate and records its lockfile importer. The manual-switch component keeps its behavior and receives its missing bilingual locale keys. Neither component is newly enabled in the default Web composition.

## Alternatives considered

**Copy the host runtime.** Its bytes are not derived from the workflow checkout, so the image revision would not identify the running implementation.

**Use the Python SDK carrier.** Its packaged entry serves JSON-RPC; the self-hosted service needs the Web CLI, frontend and plugin dependencies.

## Consequences

The release manager can bind image bytes to source and preserve data independently. Frozen installation, official source build and packaged Web HTTP startup have passed locally on macOS. Linux image/native-module readiness, browser/API streaming behavior and migration remain separate unverified checks. Existing SDK packaging and CLI host validation remain unchanged; required private-pull credentials stay external.
