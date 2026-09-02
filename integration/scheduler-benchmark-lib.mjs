import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

const OPTIONS = new Set([
  "--arrival-ms", "--base-url", "--concurrency", "--endpoint-id",
  "--max-cache-p95-ms", "--max-cost-per-page", "--max-p95-ms",
  "--max-parse-p95-ms", "--max-prepare-p95-ms", "--min-documents",
  "--min-peak-workers", "--output", "--sample-ms",
  "--scale-down-seconds", "--timeout-ms",
])
const FLAGS = new Set([
  "--cache-pass", "--dry-run", "--help", "--release-gate",
  "--require-scale-down", "--require-vast", "--wait-for-scale-down",
])

export function parseArgs(argv, env = process.env) {
  const divider = argv.indexOf("--")
  const optionArgs = divider < 0 ? argv : argv.slice(0, divider)
  const paths = divider < 0 ? [] : argv.slice(divider + 1)
  const values = new Map()
  const flags = new Set()
  for (let index = 0; index < optionArgs.length; index += 1) {
    const name = optionArgs[index]
    if (FLAGS.has(name)) { flags.add(name); continue }
    if (!OPTIONS.has(name)) throw new Error(`Unknown option: ${name}`)
    const value = optionArgs[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
    values.set(name, value)
    index += 1
  }
  const number = (name, fallback, minimum) => {
    const value = Number(values.get(name) ?? fallback)
    if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be at least ${minimum}`)
    return value
  }
  const integer = (name, fallback, minimum) => {
    const value = number(name, fallback, minimum)
    if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`)
    return value
  }
  const optional = (name, minimum = 0) => values.has(name) ? number(name, 0, minimum) : null
  const baseUrl = values.get("--base-url") ?? env.ENGRAMLY_BASE_URL ?? "https://api-preview.engramly.net"
  const parsedUrl = new URL(baseUrl)
  if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error("--base-url must be an HTTP URL without embedded credentials")
  const endpointId = values.get("--endpoint-id") ?? env.VAST_ENDPOINT_ID
  if (endpointId && !/^[1-9]\d*$/.test(endpointId)) throw new Error("--endpoint-id must be a positive integer")
  return {
    help: flags.has("--help"), dryRun: flags.has("--dry-run"), cachePass: flags.has("--cache-pass"),
    releaseGate: flags.has("--release-gate"),
    requireScaleDown: flags.has("--require-scale-down"),
    requireVast: flags.has("--require-vast"),
    waitForScaleDown: flags.has("--wait-for-scale-down"),
    baseUrl: parsedUrl.toString().replace(/\/$/, ""),
    concurrency: integer("--concurrency", 4, 1),
    arrivalMs: integer("--arrival-ms", 0, 0),
    endpointId,
    output: resolve(values.get("--output") ?? `scheduler-benchmark-${Date.now()}.json`),
    sampleMs: integer("--sample-ms", 2_000, 250),
    scaleDownSeconds: number("--scale-down-seconds", 240, 0),
    timeoutMs: integer("--timeout-ms", 1_200_000, 1_000),
    minDocuments: integer("--min-documents", 4, 1),
    minPeakWorkers: integer("--min-peak-workers", 0, 0),
    maxP95Ms: optional("--max-p95-ms", 1),
    maxPrepareP95Ms: optional("--max-prepare-p95-ms", 1),
    maxParseP95Ms: optional("--max-parse-p95-ms", 1),
    maxCacheP95Ms: optional("--max-cache-p95-ms", 1),
    maxCostPerPage: optional("--max-cost-per-page", 0),
    paths: paths.map(path => resolve(path)),
  }
}

export async function fixtures(paths) {
  const items = await Promise.all(paths.map(async path => {
    const bytes = new Uint8Array(await readFile(path))
    return { path, file: basename(path), bytes, size: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") }
  }))
  const duplicate = items.find((item, index) => items.findIndex(other => other.hash === item.hash) !== index)
  if (duplicate) throw new Error(`Duplicate PDF content is not a scheduler workload: ${duplicate.file}`)
  return items
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function sanitizeEndpoint(value) {
  if (!value) return null
  return { id: value.id, name: value.endpoint_name, minLoad: finite(value.min_load), coldWorkers: finite(value.cold_workers), maxWorkers: finite(value.max_workers), inactivitySeconds: finite(value.inactivity_timeout), targetUtil: finite(value.target_util) }
}

export function sanitizeWorker(value) {
  return { id: value.id, instanceId: value.instance_id ?? value.contract_id ?? value.id, status: value.status ?? value.actual_status, measuredPerf: finite(value.measured_perf), gpu: value.gpu_name, hourly: finite(value.dph_total) }
}

export function sanitizeInstance(value) {
  return { id: value.id, status: value.actual_status, intendedStatus: value.intended_status, hourly: finite(value.dph_total), gpu: value.gpu_name, gpus: finite(value.num_gpus), start: finite(value.start_date), end: finite(value.end_date) }
}

export function sample(at, endpoint, workers, instances) {
  const cleanWorkers = workers.map(sanitizeWorker)
  const ids = new Set(cleanWorkers.flatMap(worker => worker.instanceId === undefined ? [] : [String(worker.instanceId)]))
  const cleanInstances = instances.map(sanitizeInstance).filter(instance => ids.has(String(instance.id)))
  const rates = new Map(cleanInstances.map(instance => [String(instance.id), instance.hourly]))
  const active = cleanWorkers.filter(worker => !["exited", "stopped", "offline"].includes(String(worker.status).toLowerCase())).map(worker => ({ ...worker, hourly: worker.hourly ?? rates.get(String(worker.instanceId)) }))
  return { at, endpoint: sanitizeEndpoint(endpoint), workers: active }
}

export function ready(worker) {
  return String(worker.status ?? "").toLowerCase() === "idle"
    && (finite(worker.measuredPerf) ?? 0) > 0
}

export function cost(samples, until = Infinity) {
  const all = [...samples].sort((a, b) => a.at - b.at)
  const ordered = all.filter(item => item.at <= until)
  const prior = ordered.at(-1)
  if (prior && Number.isFinite(until) && prior.at < until) ordered.push({ ...prior, at: until })
  const intervals = ordered.slice(0, -1).map((item, index) => {
    const seconds = Math.max(0, ordered[index + 1].at - item.at) / 1_000
    const hourly = item.workers.reduce((sum, worker) => sum + (worker.hourly ?? 0), 0)
    const unknown = item.workers.filter(worker => worker.hourly === undefined).length
    return { seconds, hourly, workers: item.workers.length, unknown }
  })
  return {
    method: "left-step integration of sampled active Vast worker residency", samples: ordered.length,
    workerSeconds: round(intervals.reduce((sum, item) => sum + item.seconds * item.workers, 0)),
    estimatedComputeDollars: round(intervals.reduce((sum, item) => sum + item.hourly * item.seconds / 3_600, 0), 6),
    peakWorkers: Math.max(0, ...ordered.map(item => item.workers.length)),
    peakReadyWorkers: Math.max(0, ...ordered.map(item => item.workers.filter(ready).length)),
    peakHourlyDollars: round(Math.max(0, ...intervals.map(item => item.hourly)), 4),
    unknownRateWorkerSeconds: round(intervals.reduce((sum, item) => sum + item.seconds * item.unknown, 0)),
  }
}

export function summary(results, field = "elapsedMs") {
  const successful = results.filter(item => item.ok)
  const sorted = successful.map(item => finite(item[field])).filter(value => value !== undefined).sort((a, b) => a - b)
  const percentile = value => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] : null
  const origins = Object.fromEntries([...new Set(successful.map(item => item.request?.origin ?? "unknown"))].map(origin => [origin, successful.filter(item => (item.request?.origin ?? "unknown") === origin).length]))
  return { ok: successful.length, failed: results.length - successful.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null, origins }
}

export function latency(results) {
  return {
    endToEnd: summary(results),
    preparation: summary(results, "prepareMs"),
    parse: summary(results, "parseMs"),
  }
}

export function telemetry(results) {
  const timing = (phase, key) => {
    const sorted = results.flatMap(item => {
      const value = finite(item[phase]?.timings?.[key])
    return value === undefined ? [] : [value]
    }).sort((a, b) => a - b)
    const percentile = quantile => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] : null
    return { samples: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null }
  }
  const inspected = results.filter(item => item.inspect)
  const parsed = results.filter(item => item.request)
  const inspectionCache = {
    hit: inspected.filter(item => item.inspect?.inspectCache === "hit").length,
    miss: inspected.filter(item => item.inspect?.inspectCache === "miss").length,
    unknown: inspected.filter(item => !["hit", "miss"].includes(item.inspect?.inspectCache)).length,
  }
  const parseCache = Object.fromEntries([...new Set(parsed.map(item => item.request?.cache ?? "unknown"))].map(cache => [cache, parsed.filter(item => (item.request?.cache ?? "unknown") === cache).length]))
  const failurePhases = Object.fromEntries([...new Set(results.filter(item => !item.ok).map(item => item.error?.phase ?? "unknown"))].map(phase => [phase, results.filter(item => !item.ok && (item.error?.phase ?? "unknown") === phase).length]))
  const keys = ["upload", "form", "unkey", "hash", "kv", "inspect_edge", "inspect_modal", "scale", "warm_start", "warm", "admit", "vast", "modal", "total"]
  const timings = phase => Object.fromEntries(keys.map(key => [key, timing(phase, key)]).filter(([, value]) => value.samples))
  return { inspectionCache, parseCache, failurePhases, inspectTimings: timings("inspect"), parseTimings: timings("request") }
}

export function cacheCandidates(items, unique) {
  const successful = new Set(unique.filter(result => result.ok).map(result => result.id))
  return items.filter(item => successful.has(item.hash.slice(0, 12)))
}

export function release(report, config) {
  const unique = report.results.filter(item => item.phase === "unique")
  const cached = report.results.filter(item => item.phase === "cache")
  const successful = unique.filter(item => item.ok)
  const evidence = item => item.cache === "hit" || item.request?.cache === "edge"
  const failures = report.results.filter(item => !item.ok)
  const checks = [
    check("minimum_unique_documents", unique.length >= config.minDocuments, unique.length, config.minDocuments),
    check("zero_request_failures", failures.length === 0, failures.length, 0),
    check("no_524_responses", !failures.some(item => item.error?.status === 524), failures.filter(item => item.error?.status === 524).length, 0),
    check("preflight_supported", successful.length === unique.length && successful.every(item => item.preflight?.supported === true), successful.filter(item => item.preflight?.supported === true).length, unique.length),
    check("cache_pass_complete", cached.length === unique.length && cached.every(item => item.ok), cached.filter(item => item.ok).length, unique.length),
    check("cache_hits_observed", cached.length === unique.length && cached.every(evidence), cached.filter(evidence).length, unique.length),
  ]
  const threshold = (name, actual, limit) => {
    if (limit === null) return
    checks.push(check(name, actual !== null && actual <= limit, actual, limit))
  }
  threshold("unique_e2e_p95_ms", report.latency.unique.endToEnd.p95Ms, config.maxP95Ms)
  threshold("unique_preparation_p95_ms", report.latency.unique.preparation.p95Ms, config.maxPrepareP95Ms)
  threshold("unique_parse_p95_ms", report.latency.unique.parse.p95Ms, config.maxParseP95Ms)
  threshold("cache_e2e_p95_ms", report.latency.cache?.endToEnd.p95Ms ?? null, config.maxCacheP95Ms)
  if (config.minPeakWorkers > 0) checks.push(check("peak_ready_workers", report.cost.peakReadyWorkers >= config.minPeakWorkers, report.cost.peakReadyWorkers, config.minPeakWorkers))
  if (config.requireVast) checks.push(check("vast_origin_observed", successful.some(item => item.request?.origin === "vast"), successful.filter(item => item.request?.origin === "vast").length, 1))
  if (config.requireScaleDown) checks.push(check("scale_down_observed", report.sampling?.observedScaleDown === true, report.sampling?.observedScaleDown ?? null, true))
  if (report.sampling) checks.push(check("vast_sampling_clean", report.sampling.errors.length === 0, report.sampling.errors.length, 0))
  if (config.maxCostPerPage !== null) {
    checks.push(check("known_worker_rates", report.cost.unknownRateWorkerSeconds === 0, report.cost.unknownRateWorkerSeconds, 0))
    checks.push(check("cost_per_page", report.cost.dollarsPerPage !== null && report.cost.dollarsPerPage <= config.maxCostPerPage, report.cost.dollarsPerPage, config.maxCostPerPage))
  }
  return { passed: checks.every(item => item.passed), checks }
}

export function capability(response) {
  const values = new Set((response.headers.get("x-engram-capabilities") ?? "").split(",").map(value => value.trim()).filter(Boolean))
  const required = ["pdf-async-prepare", "pdf-preflight"]
  return {
    ok: response.ok && required.every(value => values.has(value)),
    status: response.status,
    version: response.headers.get("x-engram-api-version"),
    capabilities: [...values].sort(),
    missing: required.filter(value => !values.has(value)),
  }
}

function check(name, passed, actual, expected) { return { name, passed, actual, expected } }

function round(value, digits = 1) { const scale = 10 ** digits; return Math.round(value * scale) / scale }
