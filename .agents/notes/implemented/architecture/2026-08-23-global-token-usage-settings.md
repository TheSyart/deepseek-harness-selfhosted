# Agent Note: Global Token usage is a Host report over a per-call projection

Status: implemented

English | [中文](2026-08-23-global-token-usage-settings.zh.md)

## Problem

The existing `tokenUsage` projection answers a different question: it gives one session's latest aggregate to browser clients. A global settings report needs the date and exact route of every provider-reported call across live, persisted, archived, and child-agent sessions. Summing ordinary session list values cannot recover those dimensions, and it double-counts the parent history copied into a fork. Replaying every stored log on each 30-second browser refresh is correct but operationally wasteful. Missing usage must remain missing; heuristic token estimates are useful for context pressure but are not provider measurements.

## Decision

`@deepseek-ai/dsh-token-meter` owns a fourth projection, `tokenUsageTimeline`, because it already owns the provider-usage replacement semantics. The projection is Host-only: it has a persisted checkpoint but no client wire value and therefore never enters `session.list` or live projection frames. It retains one sample per `(turn, step)` with the first usage seq, `step/start` time, exact request-header route or an explicit unknown route, and four mutually exclusive buckets. A later cumulative usage sample replaces the buckets without changing attribution, usage reported before failure remains, and reasoning is not added again to output. Reverse-linked bounded chunks make live appends independent of total history length, while the projection's detach-only checkpoint policy avoids serializing the growing timeline at every periodic live checkpoint.

The first usage seq is the ownership marker for forks. Global aggregation excludes samples whose seq is below that session header's `seedLength`; the original session remains the sole owner of copied parent calls. Deleting the original therefore removes those calls from the report instead of transferring ownership to surviving forks.

`SessionProjectionCache.coldState(sessionId, projectionKey, signal?)` exposes the existing checkpoint, version invalidation, identity check, tail replay, and write-back ladder for one state selected through `SessionProjectionStateMap`. This is a generic Host read, not a token-specific cache path, and it also covers future projections that intentionally have no client view.

`@deepseek-ai/dsh-token-usage-report` is a Host Remote rather than a session protocol extension. It merges persistence listing with live sessions, preferring live state for a duplicate id. Persisted results are memoized by the persistence log revision, and cold reads run under an explicitly configured concurrency limit. A single session failure is excluded and counted in `coverage.failedSessionCount`; listing, cancellation, invalid IANA time zones, and safe-integer overflow reject the whole request. Lifetime covers every retained sample, while daily data is grouped in the requested browser time zone and limited to the inclusive rolling 365-day window.

The browser package registers an order-12 `token-usage` settings section. It keeps the 800-pixel settings surface compact by presenting Activity, Trend, and Models as separate views over one report, renders with React plus SVG/CSS, and adds no chart dependency. Activity offers daily five-quantile cells, Monday-through-Sunday weekly aggregation with partial edge weeks, and a running cumulative calendar from the rolling window start. Model trends expose the five largest exact routes plus Other; a page-lifetime visual registry keeps route colors stable, while different dashes, point markers, tooltips, accessible text, and togglable legends distinguish adjacent models without end labels or hue alone. Models initially ranks five exact routes and expands to all routes. The page polls only while visible, keeps one request in flight, cancels on disposal, and preserves the last successful result as stale on a later failure. Its 5/10/30/60-second choice is a normal user setting on loopback-equivalent local authority and process-local memory where remote browser permissions forbid the Host namespace.

No Session event is added and `SESSION_FORMAT_VERSION` remains unchanged. The report is a reconstruction of existing provider usage records, so neither SDK's session protocol changes.

## Alternatives considered

- **Aggregate client-visible `tokenUsage` values from `session.list`** — loses dates and routes, excludes Host-only or unavailable list state, and cannot remove a fork's copied parent prefix.
- **Scan complete logs on every refresh** — produces the same answer but defeats projection checkpoints and makes polling cost proportional to all retained history.
- **Estimate missing provider usage** — mixes a pressure heuristic with measured usage and gives totals a false precision.
- **Append a new Session event or maintain a mutable aggregate database** — duplicates facts already recorded by request and usage events, adds a protocol or transactional consistency problem, and changes deletion semantics.
- **Adopt a general chart library** — adds a large dependency for one compact heatmap, line chart, and ranking whose accessibility and visual encoding still require package-owned behavior.

## Consequences

The first report for a historical session without a timeline checkpoint performs one complete replay and writes the checkpoint back. Later unchanged polls reuse the revision cache; changed logs replay only their tail. Storage grows by one compact timeline sample per model call. Reports can be explicitly incomplete when individual logs cannot be read, and deleting the original owner of forked history removes that usage by design. Provider usage remains the only authority, so totals can be lower than actual traffic when an adapter reports no usage.

The [projected token usage decision](2026-07-29-projected-token-usage-and-request-context.md) remains active: context pressure and global usage solve separate problems, use different visibility, and share only the token-meter's provider-usage semantics.

## Testing

Token-meter tests cover routing, replacement, failed requests, unknown routes, timestamps, bucket separation, and the absence of a client timeline value. Projection-cache tests cover Host-only cold state, checkpoint tails, invalidation, identity mismatch, cancellation, and missing logs. Report tests cover live/cold precedence, archived and child sessions through persistence listing, fork ownership, revision reuse, bounded concurrency, IANA zones, DST, the 365-day window, partial coverage, and overflow. Client tests cover formulas, daily quantiles, weekly edge aggregation, safe cumulative sums, Top 5 plus Other, stable multi-channel series encoding, expandable ranking, type mode, visibility-aware single-flight polling, persistence mode, stale/empty/error states, legend toggles, keyboard navigation, localization, and disposal. A keyless assembled Web browser snapshot exercises the three views, daily/weekly/cumulative activity, multi-model trends, period and type switching, complete ranking, and refresh-interval persistence through the shipped bundle.
