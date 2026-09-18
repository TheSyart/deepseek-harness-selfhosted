# @deepseek-ai/dsh-token-usage-report

[English](README.md) | 中文

全局提供方上报 token 用量的 Host Remote。它聚合持久、已归档、子 agent 与实时会话中的 Host-only `tokenUsageTimeline` 投影，不估算缺失用量。同一 id 同时存在实时会话与持久快照时，以实时会话为准。

## 报告约定

`tokenUsageReport.snapshot({ timeZone }, signal?)` 验证 IANA 时区，返回全部历史 bucket，以及按该时区从今天向前滚动 365 天内的非空日。每天保留精确到提供方／模型路由的 bucket。`coverage.sessionCount` 表示进入汇总的会话数；`failedSessionCount` 点明被排除的会话数，因此部分结果绝不会伪装成完整统计。

四个 bucket 彼此互斥：未缓存输入、缓存读取、缓存写入与输出。推理 token 仍是输出的细分项，不会再次相加。所有汇总必须保持为安全整数；发生溢出时报告会拒绝，而不是四舍五入。

分叉会话会排除 `header.seedLength` 之前的时间线样本。原始会话继续拥有这些调用，因此删除原始会话也会删除其历史用量。这避免同时计算父会话与复制到分叉中的历史。

## 冷会话读取

持久会话连同日志 revision 一起列出。revision 未变时复用服务的进程内时间线缓存；revision 变化时调用 `sessionProjectionCache.coldState(sessionId, 'tokenUsageTimeline', signal)`，恢复有效检查点、回放尾部并写回刷新后的检查点。历史日志首次缺少该行时会完整回放一次。

单个冷会话失败时只排除该会话，并递增 coverage。持久化列表失败、调用方取消、无效时区与汇总溢出都会拒绝整个请求。

## 配置

`readConcurrency` 必填，因为存储延迟与 Host 容量属于部署选择。Web bundle 将其设为 `8`。

```yaml
- name: '@deepseek-ai/dsh-token-usage-report'
  config:
    readConcurrency: 8
```

## 模型体验

无。该服务读取已记录的提供方用量并返回 Host 报告，不改变模型上下文。

#### KV Cache 影响

无；该服务既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **只统计提供方上报的用量**：缺失用量会被省略而非估算，报告也不会从模型名称或 token 数推断费用。
- **首次未缓存的历史读取可能与完整日志等比例增长**：投影检查点与 revision 缓存会使之后对未变化日志的读取变为增量或在日志层零 I/O。
- **时间线随模型调用次数增长**：它为每个 `(turn, step)` 保存一条紧凑样本，使全局报告能够保留日期与精确路由归属。
