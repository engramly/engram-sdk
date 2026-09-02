# Scheduler benchmark

The scheduler benchmark sends distinct local PDFs through the public SDK flow
(`inspect → preflight → parse`) at bounded concurrency and an optional arrival
interval. An optional second pass measures the cached returning-user path. It records end-to-end
latency split into preparation, parse, and complete E2E time; gateway stage
timing, including asynchronous warm-task launch; selected origin;
ready/desired scheduler capacity; active Vast
workers, and estimated compute cost from sampled worker residency. It never
writes document text or raw Vast objects to the report.
The `scheduler` section turns the sampled timeline into explicit upper-bound
latencies: capacity request, first allocation, first ready worker, required
ready-worker count, first Vast response, and scale-down request/completion.
Each value is bounded by `sampleResolutionMs`; per-worker allocation-to-ready
times make slow image pulls or model starts visible without exposing worker
credentials.
Failed requests retain the completed preparation, failed phase, and sanitized
response timing when the gateway supplied them, so a release-blocking `524` is
attributed without replaying possibly billable work.

Validate a workload without network traffic:

```bash
bun run benchmark:scheduler -- --dry-run --concurrency 4 -- a.pdf b.pdf
```

Run against preview and observe the complete scale-down tail:

```bash
ENGRAMLY_API_KEY=... bun run benchmark:scheduler -- \
  --base-url https://api-preview.engramly.net \
  --endpoint-id 34749 \
  --concurrency 4 \
  --arrival-ms 500 \
  --cache-pass \
  --wait-for-scale-down \
  --output reports/scheduler.json \
  -- a.pdf b.pdf c.pdf d.pdf
```

Use different PDF bytes for every request; repeated content is rejected because
the scheduler deliberately deduplicates signals by content hash. Vast inspection
is read-only. The runner does not create, update, stop, or destroy instances.

The `cost` estimate integrates sampled active-worker hourly rates over wall-clock
residency. Run through scale-down for a complete per-document/per-page estimate.
Storage charges are excluded. Sampling gaps with unknown hourly rates are counted
as `unknownRateWorkerSeconds` rather than assigned a guessed price.
The command exits nonzero if any user request fails and never runs the cache
pass for a document whose unique parse failed. Treat `404` from preflight or
`524` from parse as release blockers, not latency samples.

For a release decision, make the criteria executable. This example requires
four distinct PDFs, zero failures, supported preflight, a cache hit for every
returning request, at least two inference-ready Vast workers, a real Vast response, clean
sampling, complete scale-down, known hourly rates, and explicit latency/cost
ceilings:

```bash
ENGRAMLY_API_KEY=... bun run benchmark:scheduler -- \
  --base-url https://api.engramly.net \
  --endpoint-id 34749 \
  --concurrency 4 \
  --cache-pass \
  --wait-for-scale-down \
  --release-gate \
  --min-documents 4 \
  --min-peak-workers 2 \
  --require-vast \
  --require-scale-down \
  --max-p95-ms 30000 \
  --max-prepare-p95-ms 20000 \
  --max-parse-p95-ms 20000 \
  --max-cache-p95-ms 2000 \
  --max-cost-per-page 0.001 \
  --output reports/production-release.json \
  -- a.pdf b.pdf c.pdf d.pdf
```

The limits above are an initial explicit policy, not measured production SLOs.
Adjust them deliberately after the first clean corpus run. The report contains
every check under `gate.checks`; any failed check makes the command exit nonzero.
Before reading fixtures or invoking the SDK, release mode probes `/v1/health`
and requires gateway capability headers for async preparation and preflight. An
old or partially deployed gateway therefore fails without sending billable parse
requests.
The worker peak counts only `idle` workers with a positive measured benchmark
rate. Creating or loading allocations remain visible in `peakWorkers`, but do
not satisfy `--min-peak-workers`.
The release gate also requires its first control-plane sample to show both zero
active workers and a zero endpoint capacity floor. This proves a run began from
scale-to-zero instead of inheriting an already-paid warm fleet.
