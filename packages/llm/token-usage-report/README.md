# @deepseek-ai/dsh-token-usage-report

English | [中文](README.zh.md)

Host Remote for global provider-reported token usage. It aggregates the Host-only `tokenUsageTimeline` projection across persisted, archived, child-agent, and live sessions without estimating missing usage. A live session supersedes the persisted snapshot with the same id.

## Report contract

`tokenUsageReport.snapshot({ timeZone }, signal?)` validates an IANA time zone and returns lifetime buckets plus non-empty calendar days in the rolling 365-day window ending today in that zone. Every day retains exact provider/model route buckets. `coverage.sessionCount` counts sessions included in the aggregate; `failedSessionCount` identifies excluded sessions, so a partial result is never presented as complete.

The four buckets are mutually exclusive: uncached input, cache reads, cache writes, and output. Reasoning tokens remain an output subdivision and are not added again. All sums must remain safe integers; overflow rejects the report instead of rounding it.

Forked sessions exclude timeline samples before `header.seedLength`. The original session remains the owner of those calls, so deleting it also removes its historical usage. This avoids charging both a parent and the history copied into a fork.

## Cold-session reads

Persisted sessions are listed with their log revisions. An unchanged revision reuses the service's process-local timeline cache; a changed revision calls `sessionProjectionCache.coldState(sessionId, 'tokenUsageTimeline', signal)`, which restores any valid checkpoint, replays the tail, and writes back the refreshed checkpoint. The first read of a historical log without that row performs one full replay.

A single cold-session failure excludes that session and increments coverage. Failure to list persistence, caller cancellation, invalid time zones, and aggregate overflow reject the complete request.

## Configuration

`readConcurrency` is required because storage latency and host capacity are deployment choices. The Web bundle sets it to `8`.

```yaml
- name: '@deepseek-ai/dsh-token-usage-report'
  config:
    readConcurrency: 8
```

## Model Experience

None, as the service reads already-logged provider usage and returns a Host report without changing model context.

#### KV Cache effect

None; the service neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **Only provider-reported usage is counted** — missing usage is omitted rather than estimated, and the report does not infer costs from model names or token counts.
- **The first uncached historical read can be proportional to the complete log** — the projection checkpoint and revision cache make later unchanged reads incremental or zero-I/O at the log layer.
- **The timeline grows with model calls** — it stores one compact sample per `(turn, step)` so global reports can retain date and exact-route attribution.
