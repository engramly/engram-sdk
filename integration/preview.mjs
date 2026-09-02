#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"

const base = (process.env.ENGRAMLY_PREVIEW_URL ?? "https://api-preview.engramly.net").replace(/\/$/, "")
const key = process.env.ENGRAMLY_API_KEY ?? process.env.ENGRAM_API_KEY
const local = process.env.ENGRAMLY_TEST_PDF
const large = process.env.ENGRAMLY_TEST_LARGE_PDF
const remote = process.env.ENGRAMLY_TEST_REMOTE_PDF
if (!key || !local || !large || !remote) throw new Error("Set ENGRAMLY_API_KEY, ENGRAMLY_TEST_PDF, ENGRAMLY_TEST_LARGE_PDF, and ENGRAMLY_TEST_REMOTE_PDF")
const largeBytes = (await stat(large)).size
if (largeBytes > 10 * 1024 * 1024) throw new Error(`ENGRAMLY_TEST_LARGE_PDF is ${(largeBytes / 1024 / 1024).toFixed(1)} MiB; the API limit is 10 MiB. Choose a 60+ page fixture below the limit.`)

async function call(path, source, fields = {}) {
  const started = Date.now()
  const form = new FormData()
  if (/^https:\/\//.test(source)) form.set("url", source)
  else form.set("file", new Blob([await readFile(source)], { type: "application/pdf" }), basename(source))
  for (const [name, value] of Object.entries(fields)) form.set(name, String(value))
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form })
  const text = await response.text()
  const body = (() => { try { return JSON.parse(text) } catch { return null } })()
  console.error(`[${path}] status=${response.status} elapsed=${Date.now() - started}ms${body?.metadata?.cache ? ` cache=${body.metadata.cache}` : ""}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text.slice(0, 1_000)}`)
  if (!body) throw new Error(`${path} returned non-JSON success: ${text.slice(0, 1_000)}`)
  return { body, headers: response.headers }
}

const inspect = await call("/v1/pdf/inspect", local)
if (!(inspect.body.pages > 0) || !inspect.body.document_id) throw new Error("Local inspect contract failed")
const localRange = inspect.body.pages >= 2 ? "1-2" : "1"
const sliced = await call("/v1/pdf/parse", local, { pages: localRange })
if (sliced.body.page_markdown?.map(page => page.page).join(",") !== localRange.replace("-", ",")) throw new Error("Original page mapping failed")
const cached = await call("/v1/pdf/parse", local, { pages: localRange })
if (cached.body.metadata?.cache !== "hit") throw new Error("Cache hit was not observed")
const remoteInspect = await call("/v1/pdf/inspect", remote)
if (!(remoteInspect.body.pages > 0)) throw new Error("Remote inspect failed")
const largeInspect = await call("/v1/pdf/inspect", large)
if (!(largeInspect.body.pages >= 60)) throw new Error(`Large fixture has only ${largeInspect.body.pages} pages`)
const largeSlice = await call("/v1/pdf/parse", large, { pages: "1,30,60" })
if (largeSlice.body.page_markdown?.map(page => page.page).join(",") !== "1,30,60") throw new Error("Large document page mapping failed")
const invalid = await fetch(`${base}/v1/pdf/parse`, { method: "POST" })
if (invalid.status !== 401) throw new Error(`Missing credential response was ${invalid.status}, expected 401`)
console.log(JSON.stringify({ localPages: inspect.body.pages, remotePages: remoteInspect.body.pages, largePages: largeInspect.body.pages, cache: cached.body.metadata.cache, billing: cached.body.metadata.billing, status: "ok" }, null, 2))
