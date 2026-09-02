import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { cacheCandidates, capability, cost, fixtures, latency, parseArgs, ready, release, sample, summary, telemetry } from "./scheduler-benchmark-lib.mjs"

describe("scheduler benchmark", () => {
  test("parses only PDF paths after the separator", () => {
    const result = parseArgs(["--concurrency", "3", "--arrival-ms", "100", "--cache-pass", "--endpoint-id", "42", "--", "a.pdf", "b.pdf"], {})
    expect(result.concurrency).toBe(3); expect(result.arrivalMs).toBe(100); expect(result.cachePass).toBe(true); expect(result.endpointId).toBe("42")
    expect(result.paths.map(path => path.endsWith("pdf"))).toEqual([true, true])
  })

  test("parses explicit release thresholds", () => {
    const result = parseArgs([
      "--release-gate", "--require-vast", "--require-scale-down",
      "--min-documents", "8", "--min-peak-workers", "2",
      "--max-p95-ms", "30000", "--max-cost-per-page", "0.001", "--", "a.pdf",
    ], {})
    expect(result).toMatchObject({
      releaseGate: true, requireVast: true, requireScaleDown: true,
      minDocuments: 8, minPeakWorkers: 2, maxP95Ms: 30000, maxCostPerPage: 0.001,
    })
  })

  test("requires deployed async preparation capabilities before release traffic", () => {
    const current = capability(new Response(null, {
      headers: {
        "x-engram-api-version": "2026-09-01",
        "x-engram-capabilities": "pdf-preflight,pdf-async-prepare,pdf-remote-source-v1",
      },
    }))
    expect(current).toMatchObject({ ok: true, version: "2026-09-01", missing: [] })
    expect(capability(new Response(null))).toMatchObject({
      ok: false, missing: ["pdf-async-prepare", "pdf-preflight"],
    })
  })

  test("rejects invalid bounds and duplicate fixture content", async () => {
    expect(() => parseArgs(["--concurrency", "1.5", "--", "a.pdf"], {})).toThrow("integer")
    expect(() => parseArgs(["--endpoint-id", "nope", "--", "a.pdf"], {})).toThrow("positive integer")
    const root = await mkdtemp(join(tmpdir(), "engram-benchmark-"))
    const first = join(root, "a.pdf"); const second = join(root, "b.pdf")
    await Promise.all([writeFile(first, "same"), writeFile(second, "same")])
    await expect(fixtures([first, second])).rejects.toThrow("Duplicate PDF content")
    await rm(root, { recursive: true, force: true })
  })

  test("sanitizes snapshots and integrates sampled residency cost", () => {
    const first = sample(0, { id: 42, endpoint_name: "pdf", min_load: 1 }, [{ id: 7, status: "loading", measured_perf: 87, secret: "x" }], [{ id: 7, actual_status: "running", dph_total: 0.9, ssh_host: "secret" }])
    const second = sample(10_000, { id: 42 }, [{ id: 7, status: "idle", measured_perf: 87 }], [{ id: 7, actual_status: "running", dph_total: 0.9 }])
    const third = sample(20_000, { id: 42 }, [], [])
    expect(JSON.stringify(first)).not.toContain("secret")
    expect(cost([first, second, third])).toMatchObject({ workerSeconds: 20, estimatedComputeDollars: 0.005, peakWorkers: 1, peakReadyWorkers: 1, peakHourlyDollars: 0.9 })
    expect(cost([first, second, third], 15_000)).toMatchObject({ workerSeconds: 15, estimatedComputeDollars: 0.00375 })
    expect(ready(first.workers[0])).toBe(false)
    expect(ready(second.workers[0])).toBe(true)
  })

  test("reports user-facing latency percentiles and origins", () => {
    expect(summary([{ ok: true, elapsedMs: 10, request: { origin: "vast" } }, { ok: true, elapsedMs: 30, request: { origin: "edge" } }, { ok: false, elapsedMs: 1 }])).toEqual({ ok: 2, failed: 1, p50Ms: 10, p95Ms: 30, maxMs: 30, origins: { vast: 1, edge: 1 } })
  })

  test("separates preparation from parse latency", () => {
    expect(latency([
      { ok: true, elapsedMs: 30, prepareMs: 10, parseMs: 20 },
      { ok: true, elapsedMs: 60, prepareMs: 15, parseMs: 45 },
    ])).toMatchObject({
      endToEnd: { p50Ms: 30, p95Ms: 60 },
      preparation: { p50Ms: 10, p95Ms: 15 },
      parse: { p50Ms: 20, p95Ms: 45 },
    })
  })

  test("summarizes inspection cache and gateway timing telemetry", () => {
    expect(telemetry([
      { ok: true, inspect: { inspectCache: "miss", timings: { inspect_modal: 30, warm_start: 4, total: 40 } }, request: { cache: "miss", timings: { modal: 100, total: 110 } } },
      { ok: true, inspect: { inspectCache: "hit", timings: { inspect_edge: 2, total: 5 } }, request: { cache: "edge", timings: { total: 8 } } },
      { ok: false },
    ])).toMatchObject({
      inspectionCache: { hit: 1, miss: 1, unknown: 0 },
      parseCache: { miss: 1, edge: 1 },
      inspectTimings: {
        inspect_edge: { samples: 1, p50Ms: 2 },
        inspect_modal: { samples: 1, p50Ms: 30 },
        warm_start: { samples: 1, p50Ms: 4 },
        total: { samples: 2, p50Ms: 5, p95Ms: 40 },
      },
      parseTimings: {
        modal: { samples: 1, p50Ms: 100 },
        total: { samples: 2, p50Ms: 8, p95Ms: 110 },
      },
      failurePhases: { unknown: 1 },
    })
  })

  test("keeps telemetry from failed parse responses", () => {
    expect(telemetry([{
      ok: false, error: { phase: "parse" },
      inspect: { inspectCache: "hit", timings: { inspect_edge: 2 } },
      request: { cache: "miss", timings: { modal: 140000, total: 144000 } },
    }])).toMatchObject({
      inspectionCache: { hit: 1, miss: 0, unknown: 0 },
      parseCache: { miss: 1 },
      failurePhases: { parse: 1 },
      parseTimings: { modal: { samples: 1, p50Ms: 140000 } },
    })
  })

  test("repeats only successful documents during the cache phase", () => {
    const items = [{ hash: "abcdef1234567890" }, { hash: "123456abcdef7890" }]
    expect(cacheCandidates(items, [
      { id: "abcdef123456", ok: true },
      { id: "123456abcdef", ok: false },
    ])).toEqual([items[0]])
  })

  test("passes a fully evidenced production release report", () => {
    const unique = Array.from({ length: 4 }, (_, index) => ({
      phase: "unique", ok: true, elapsedMs: 20_000 + index, prepareMs: 10_000, parseMs: 10_000,
      preflight: { supported: true }, request: { origin: index === 0 ? "vast" : "modal" },
    }))
    const cached = Array.from({ length: 4 }, () => ({
      phase: "cache", ok: true, elapsedMs: 100, cache: "hit", request: { origin: "edge", cache: "edge" },
    }))
    const results = [...unique, ...cached]
    const report = {
      results, latency: { unique: latency(unique), cache: latency(cached) },
      sampling: { observedScaleDown: true, errors: [] },
      cost: { peakWorkers: 2, peakReadyWorkers: 2, unknownRateWorkerSeconds: 0, dollarsPerPage: 0.0005 },
    }
    const gate = release(report, {
      minDocuments: 4, minPeakWorkers: 2, requireVast: true, requireScaleDown: true,
      maxP95Ms: 30_000, maxPrepareP95Ms: 15_000, maxParseP95Ms: 15_000,
      maxCacheP95Ms: 500, maxCostPerPage: 0.001,
    })
    expect(gate.passed).toBe(true)
    expect(gate.checks.every(item => item.passed)).toBe(true)
  })

  test("fails release when correctness, cache, scaling, or SLO evidence is missing", () => {
    const unique = [{
      phase: "unique", ok: false, elapsedMs: 144_000, prepareMs: 4_000, parseMs: 140_000,
      preflight: { supported: false }, error: { status: 524 }, request: { origin: "modal" },
    }]
    const report = {
      results: unique, latency: { unique: latency(unique), cache: latency([]) },
      sampling: { observedScaleDown: false, errors: [{ error: "vast_snapshot_failed" }] },
      cost: { peakWorkers: 0, peakReadyWorkers: 0, unknownRateWorkerSeconds: 10, dollarsPerPage: null },
    }
    const gate = release(report, {
      minDocuments: 4, minPeakWorkers: 2, requireVast: true, requireScaleDown: true,
      maxP95Ms: 30_000, maxPrepareP95Ms: null, maxParseP95Ms: null,
      maxCacheP95Ms: 500, maxCostPerPage: 0.001,
    })
    expect(gate.passed).toBe(false)
    expect(gate.checks.filter(item => !item.passed).map(item => item.name)).toEqual(expect.arrayContaining([
      "minimum_unique_documents", "zero_request_failures", "no_524_responses",
      "preflight_supported", "cache_pass_complete", "peak_ready_workers",
      "vast_origin_observed", "scale_down_observed", "known_worker_rates",
    ]))
  })
})
