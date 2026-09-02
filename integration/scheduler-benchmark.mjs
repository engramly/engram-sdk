#!/usr/bin/env bun
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Engram } from "../typescript/dist/index.js"
import { cacheCandidates, capability, cost, fixtures, latency, parseArgs, release, sample, schedulerLatency, telemetry } from "./scheduler-benchmark-lib.mjs"

const HELP = `Usage: bun run benchmark:scheduler -- [options] -- FILE.pdf ...

Options:
  --base-url URL              Gateway under test (default: preview)
  --concurrency N             Concurrent user requests (default: 4)
  --arrival-ms N              Delay between request arrivals (default: 0)
  --cache-pass                Repeat workload to measure cached-user latency
  --endpoint-id ID            Enables read-only Vast worker/cost sampling
  --sample-ms N               Vast sampling interval (default: 2000)
  --wait-for-scale-down       Continue sampling until zero workers
  --scale-down-seconds N      Maximum post-workload observation (default: 240)
  --timeout-ms N              Per-request SDK timeout (default: 1200000)
  --output PATH               Sanitized JSON report path
  --release-gate              Enforce correctness, cache, and configured SLO gates
  --min-documents N           Minimum unique documents for release gate (default: 4)
  --max-p95-ms N              Maximum unique E2E p95
  --max-prepare-p95-ms N      Maximum unique preparation p95
  --max-parse-p95-ms N        Maximum unique parse p95
  --max-cache-p95-ms N        Maximum cached E2E p95
  --min-peak-workers N        Required observed inference-ready Vast worker peak
  --require-vast              Require at least one successful Vast response
  --require-scale-down        Require the sampled Vast fleet to return to zero
  --max-cost-per-page USD     Maximum complete sampled Vast cost per page
  --dry-run                   Validate workload without API traffic
  --help                      Show this text

The first -- belongs to the package runner; the second separates options from PDFs.
The runner never changes Vast control-plane configuration.`

const config = parseArgs(process.argv.slice(2))
if (config.help) { console.log(HELP); process.exit(0) }
if (!config.paths.length) throw new Error(HELP)
const items = await fixtures(config.paths)
if (config.dryRun) {
  console.log(JSON.stringify({ dryRun: true, documents: items.length, requests: items.length * (config.cachePass ? 2 : 1), bytes: items.reduce((sum, item) => sum + item.size, 0), concurrency: config.concurrency, arrivalMs: config.arrivalMs, endpointId: config.endpointId ?? null }, null, 2))
  process.exit(0)
}

const key = process.env.ENGRAMLY_API_KEY ?? process.env.ENGRAM_API_KEY
if (!key) throw new Error("Set ENGRAMLY_API_KEY")
const checked = config.releaseGate
  ? capability(await fetch(`${config.baseUrl}/v1/health`, { signal: AbortSignal.timeout(30_000) }))
  : null
if (checked && !checked.ok) {
  throw new Error(`Release gate requires deployed gateway capabilities; status=${checked.status} version=${checked.version ?? "missing"} missing=${checked.missing.join(",") || "none"}`)
}
const api = new Engram({ apiKey: key, baseUrl: config.baseUrl, pdfTimeout: config.timeoutMs })
const timeline = []
const samplingErrors = []
let sampling = true
let snapshots = Promise.resolve(null)

function vast(command) {
  return new Promise((done, fail) => {
    const child = spawn("vastai", [...command, "--raw"], { stdio: ["ignore", "pipe", "pipe"] })
    const chunks = []; const errors = []
    child.stdout.on("data", chunk => chunks.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk))
    child.on("close", code => {
      if (code !== 0) { fail(new Error(Buffer.concat(errors).toString().trim())); return }
      Promise.resolve(JSON.parse(Buffer.concat(chunks).toString())).then(done, fail)
    })
  })
}

async function capture() {
  if (!config.endpointId) return null
  const [endpoints, workers, instances] = await Promise.all([vast(["show", "endpoints"]), vast(["get", "endpt-workers", config.endpointId]), vast(["show", "instances"])])
  const endpoint = endpoints.find(item => String(item.id) === String(config.endpointId))
  if (!endpoint) throw new Error(`Vast endpoint not found: ${config.endpointId}`)
  const value = sample(Date.now(), endpoint, workers, instances)
  timeline.push(value)
  return value
}

function snapshot() {
  snapshots = snapshots.catch(() => null).then(capture)
  return snapshots
}

const pause = duration => new Promise(done => setTimeout(done, duration))
async function monitor() {
  if (!config.endpointId) return
  while (sampling) {
    await pause(config.sampleMs)
    if (!sampling) return
    await snapshot().catch(() => samplingErrors.push({ at: Date.now(), error: "vast_snapshot_failed" }))
  }
}

async function run(item, phase) {
  const startedAt = Date.now()
  const started = performance.now()
  try {
    const job = await api.pdf.parsePrepared(item.bytes)
    const finished = performance.now()
    return { phase, id: item.hash.slice(0, 12), file: item.file, bytes: item.size, pages: job.result.pages, ok: true, started: new Date(startedAt).toISOString(), finished: new Date().toISOString(), elapsedMs: Math.round((finished - started) * 10) / 10, prepareMs: job.elapsedMs, parseMs: job.result.request.elapsedMs, cache: job.result.metadata.cache ?? null, inspect: job.inspect.request, preflight: job.preflight, request: job.result.request }
  } catch (error) {
    const message = String(error?.message ?? "request_failed").replaceAll(key, "[redacted]").slice(0, 512)
    const prepared = error?.prepared
    const inspect = prepared?.inspect?.request ?? (error?.phase === "inspect" ? error?.request : null)
    const preflight = prepared?.preflight ?? (error?.phase === "preflight" ? { request: error?.request } : null)
    const request = error?.phase === "parse" ? error?.request : null
    const prepareMs = prepared?.elapsedMs ?? null
    return { phase, id: item.hash.slice(0, 12), file: item.file, bytes: item.size, pages: prepared?.inspect?.pages ?? null, ok: false, started: new Date(startedAt).toISOString(), finished: new Date().toISOString(), elapsedMs: Math.round((performance.now() - started) * 10) / 10, prepareMs, parseMs: request?.elapsedMs ?? null, inspect, preflight, request, error: { name: error?.name, code: error?.code, status: error?.status, phase: error?.phase, message } }
  }
}

async function pool(values, phase) {
  const epoch = Date.now()
  const pending = values.map((item, index) => ({ item, index })); const results = []
  const worker = async () => {
    while (pending.length) {
      const job = pending.shift()
      if (!job) continue
      const delay = Math.max(0, epoch + job.index * config.arrivalMs - Date.now())
      if (delay) await pause(delay)
      results.push(await run(job.item, phase))
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.concurrency, values.length) }, worker))
  return results
}

const startedAt = Date.now()
if (config.endpointId) await snapshot()
const watcher = monitor()
const unique = await pool(items, "unique")
const cached = config.cachePass ? await pool(
  cacheCandidates(items, unique), "cache",
) : []
const results = [...unique, ...cached]
const workloadFinishedAt = Date.now()
if (config.endpointId) await snapshot().catch(() => samplingErrors.push({ at: Date.now(), error: "vast_snapshot_failed" }))
if (config.waitForScaleDown && config.endpointId) {
  const deadline = Date.now() + config.scaleDownSeconds * 1_000
  while (Date.now() < deadline && (timeline.at(-1)?.workers.length ?? 1) > 0) await pause(Math.min(config.sampleMs, Math.max(1, deadline - Date.now())))
}
sampling = false
await watcher
const spend = cost(timeline)
const useful = cost(timeline, workloadFinishedAt)
const workload = { documents: items.length, requests: results.length, pages: unique.reduce((sum, item) => sum + (item.pages ?? 0), 0), bytes: items.reduce((sum, item) => sum + item.size, 0) }
const scheduler = config.endpointId
  ? schedulerLatency(timeline, results, startedAt, workloadFinishedAt, Math.max(1, config.minPeakWorkers))
  : null
const core = {
  schema: 4, started: new Date(startedAt).toISOString(), finished: new Date().toISOString(), workloadFinished: new Date(workloadFinishedAt).toISOString(), baseUrl: config.baseUrl, concurrency: config.concurrency, gateway: checked,
  sampling: config.endpointId ? { endpointId: config.endpointId, intervalMs: config.sampleMs, waitedForScaleDown: config.waitForScaleDown, observedScaleDown: timeline.at(-1)?.workers.length === 0, errors: samplingErrors } : null, workload,
  latency: { overall: latency(results), unique: latency(unique), cache: config.cachePass ? latency(cached) : null },
  telemetry: { overall: telemetry(results), unique: telemetry(unique), cache: config.cachePass ? telemetry(cached) : null },
  scheduler,
  cost: { ...spend, workloadComputeDollars: useful.estimatedComputeDollars, scaleDownTailDollars: Math.max(0, spend.estimatedComputeDollars - useful.estimatedComputeDollars), dollarsPerDocument: timeline.length && workload.documents ? spend.estimatedComputeDollars / workload.documents : null, dollarsPerPage: timeline.length && workload.pages ? spend.estimatedComputeDollars / workload.pages : null },
  timeline, results,
}
const gate = config.releaseGate ? release(core, config) : null
const report = { ...core, gate }
await mkdir(resolve(config.output, ".."), { recursive: true })
await writeFile(config.output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ output: config.output, latency: report.latency, scheduler: report.scheduler, pages: workload.pages, cost: report.cost, gate }, null, 2))
if (results.some(item => !item.ok) || gate?.passed === false) process.exitCode = 1
