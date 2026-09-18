# @deepseek-ai/dsh-client-ui-settings-token-usage

English | [中文](README.zh.md)

Compact Token Usage section for the browser settings shell. It registers `settings.section` id `token-usage` at order `12` and reads the global Host report in the browser's current IANA time zone.

## Dashboard

The lifetime cards show total tokens, all input tokens, output tokens, and cache hit rate. Input is uncached input plus cache reads plus cache writes; hit rate is cache reads divided by all input and displays an em dash for a zero denominator. Activity, Trend, and Models are separate views over one report, so switching views does not refetch or crowd the 800-pixel settings surface.

The Activity view offers Daily, Weekly, and Cumulative aggregations. Daily and Cumulative use the 365-day calendar grid; Weekly groups Monday through Sunday and retains partial edge weeks. All three assign five quantile levels over non-zero values and use one roving keyboard focus. Cumulative means the running total from the start of the current rolling 365-day window, not Lifetime.

The 30-, 90-, and 365-day Trend view defaults to exact model routes. Its top five routes are separate series and every remaining route is combined as Other. Route colors remain stable for the page lifetime, while dash patterns, point markers, tooltips, accessible names, and legend toggles make the series distinguishable without color alone. Type mode instead presents uncached input, cache reads, cache writes, and output. The Models view shares the selected period, shows the top five routes initially, expands to every exact route, and exposes input/output composition on hover, focus, and assistive technology.

## Refresh lifecycle

The page loads immediately, polls only while mounted and visible, and refreshes as soon as a hidden page becomes visible. Requests are single-flight and cancellable. A later failure retains the last successful result and marks it stale; an initial failure presents a retry state. The selectable `5`, `10`, `30`, or `60` second interval is stored under `ui-token-usage.refreshIntervalSeconds`, defaulting to `30`. Loopback browsers persist it through user settings; a permission-restricted remote browser retains it only in the current process.

## Composition

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-token-usage'
```

The page requires the generated `tokenUsageReport` Remote plus client runtime, settings, and locale services. Its settings-navigation glyph is private to the settings shell and does not extend the shared icon API.

## Model Experience

None, as this package renders a browser-only report from already-logged usage.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **The dashboard does not estimate costs or missing usage** — it visualizes only the four provider-reported token buckets returned by the Host report.
- **Model mode limits the trend to five named routes plus Other** — the Models view retains every exact route for the selected period.
- **Calendar grouping follows the browser time zone** — changing the operating-system time zone changes day boundaries on the next report request.
