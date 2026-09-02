import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { Engram, type PdfInspectResult, type PdfOptions, type PdfParseResult } from "@engramly/engram"

export type Source = { kind: "url"; value: string } | { kind: "file"; value: string; bytes: Uint8Array }
export interface Hit { page: number; excerpt: string }
const LIMIT = 12_000

export async function source(value: string): Promise<Source> {
  if (/^https:\/\//i.test(value)) return { kind: "url", value }
  if (!value.startsWith("/")) throw new Error("Local PDF source must be an absolute path")
  return { kind: "file", value, bytes: new Uint8Array(await readFile(value)) }
}

export function pages(value: string | undefined, total?: number): number[] {
  if (!value) return total ? Array.from({ length: total }, (_, index) => index + 1) : []
  const out = new Set<number>()
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/)
    if (!match) throw new Error(`Invalid page range: ${part}`)
    const start = Number(match[1]); const end = Number(match[2] ?? match[1])
    if (start < 1 || end < start || (total !== undefined && end > total)) throw new Error(`Page range out of bounds: ${part}`)
    for (const page of Array.from({ length: end - start + 1 }, (_, index) => start + index)) out.add(page)
  }
  return [...out].sort((a, b) => a - b)
}

function root(): string { return process.env.ENGRAMLY_CACHE_DIR ?? join(homedir(), ".cache", "engramly") }
function key(src: Source, options = ""): string { return createHash("sha256").update(src.kind === "file" ? src.bytes : src.value).update(options).digest("hex") }
async function save(id: string, name: string, value: unknown): Promise<void> { const dir = join(root(), id); await mkdir(dir, { recursive: true }); await writeFile(join(dir, name), JSON.stringify(value)) }
export async function load(id: string): Promise<PdfParseResult> { return JSON.parse(await readFile(join(root(), id, "parse.json"), "utf8")) as PdfParseResult }
function input(src: Source): string | Uint8Array { return src.kind === "url" ? src.value : src.bytes }

export class PdfAgent {
  readonly api: Engram
  constructor(api = new Engram()) { this.api = api }
  async inspect(value: string): Promise<PdfInspectResult & { cacheId: string }> {
    const src = await source(value); const id = key(src); const result = await this.api.pdf.inspect(input(src)); await save(id, "inspect.json", result)
    return { ...result, cacheId: id }
  }
  async parse(value: string, range?: string, options: Pick<PdfOptions, "onProgress"> = {}): Promise<PdfParseResult & { cacheId: string }> {
    const src = await source(value)
    const id = key(src, range ?? "all")
    const result = await this.parseSource(src, range, options)
    await save(id, "parse.json", result)
    return { ...result, cacheId: id }
  }
  private async parseSource(src: Source, range?: string, options: Pick<PdfOptions, "onProgress"> = {}): Promise<PdfParseResult> {
    if (range) return this.api.pdf.parse(input(src), { pages: range, ...options })
    if (src.kind === "url") return this.api.pdf.parse(src.value, options)
    // Always keep preparation and parse in the SDK's atomic flow. A manual
    // preflight followed by plain parse drops the private readiness hint and
    // prevents an acknowledged Vast worker from receiving the document. The
    // gateway's content-addressed inspection cache makes this inexpensive.
    return (await this.api.pdf.parsePrepared(input(src), options)).result
  }
  async read(value: string, range?: string, cursor = 0, options: Pick<PdfOptions, "onProgress"> = {}): Promise<{ text: string; nextCursor: number | null; cacheId: string }> {
    const result = /^[a-f0-9]{64}$/.test(value) ? { ...(await load(value)), cacheId: value } : await this.parse(value, range, options)
    const wanted = new Set(pages(range, result.pages)); const text = result.pageMarkdown.filter(page => !wanted.size || wanted.has(page.page)).map(page => `<!-- page:${page.page} -->\n${page.markdown}`).join("\n")
    const chunk = text.slice(cursor, cursor + LIMIT); return { text: chunk, nextCursor: cursor + chunk.length < text.length ? cursor + chunk.length : null, cacheId: result.cacheId }
  }
  async search(value: string, query: string, range?: string, options: Pick<PdfOptions, "onProgress"> = {}): Promise<{ hits: Hit[]; cacheId: string }> {
    const result = /^[a-f0-9]{64}$/.test(value) ? { ...(await load(value)), cacheId: value } : await this.parse(value, range, options)
    const wanted = new Set(pages(range, result.pages)); const needle = query.toLocaleLowerCase()
    const hits = result.pageMarkdown.filter(page => !wanted.size || wanted.has(page.page)).flatMap(page => { const at = page.markdown.toLocaleLowerCase().indexOf(needle); return at < 0 ? [] : [{ page: page.page, excerpt: page.markdown.slice(Math.max(0, at - 250), at + query.length + 250) }] }).slice(0, 8)
    return { hits, cacheId: result.cacheId }
  }
}

export function filename(value: string): string { return basename(value).replace(/\.pdf$/i, "") + ".md" }
