#!/usr/bin/env node
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { PdfAgent, filename } from "@engramly/agent-core"
import type { PdfProgress } from "@engramly/engram"

const argv = process.argv.slice(2); const json = argv.includes("--json"); const args = argv.filter(arg => arg !== "--json")
const cred = process.env.ENGRAMLY_CONFIG_DIR ? join(process.env.ENGRAMLY_CONFIG_DIR, "credentials.json") : join(homedir(), ".config", "engramly", "credentials.json")
function flag(name: string): string | undefined { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1] }
async function key(): Promise<string | undefined> { if (process.env.ENGRAMLY_API_KEY ?? process.env.ENGRAM_API_KEY) return process.env.ENGRAMLY_API_KEY ?? process.env.ENGRAM_API_KEY; return JSON.parse(await readFile(cred, "utf8").catch(() => "{}")).apiKey }
function print(value: unknown): void { console.log(json || typeof value !== "string" ? JSON.stringify(value, null, 2) : value) }
let lastProgress = 0
function progress(event: PdfProgress): void {
  if (event.state === "started") console.error(event.phase === "prepare" ? "Preparing PDF capacity…" : `Parsing${event.pages ? ` ${event.pages} page${event.pages === 1 ? "" : "s"}` : " PDF"}…`)
  if (event.state === "waiting" && event.elapsedMs - lastProgress >= 15_000) { lastProgress = event.elapsedMs; console.error(`Still preparing… ${(event.elapsedMs / 1_000).toFixed(0)}s`) }
  if (event.state === "failed") console.error(`${event.phase === "prepare" ? "Preparation" : "Parsing"} failed after ${(event.elapsedMs / 1_000).toFixed(1)}s`)
}

async function main(): Promise<void> {
  if (args[0] === "auth" && args[1] === "set") { const value = args[2]; if (!value) throw new Error("Usage: engram auth set <api-key>"); await mkdir(dirname(cred), { recursive: true }); await writeFile(cred, JSON.stringify({ apiKey: value }, null, 2)); await chmod(cred, 0o600); print("Credentials saved"); return }
  if (args[0] === "auth" && args[1] === "status") { print({ configured: Boolean(await key()), source: process.env.ENGRAMLY_API_KEY ? "ENGRAMLY_API_KEY" : "credentials" }); return }
  if (args[0] === "auth" && args[1] === "logout") { await rm(cred, { force: true }); print("Credentials removed"); return }
  if (args[0] !== "pdf") throw new Error("Usage: engram auth ... | engram pdf <inspect|read|search|parse> ...")
  const apiKey = await key(); if (!apiKey) throw new Error("Set ENGRAMLY_API_KEY or run `engram auth set <api-key>`"); process.env.ENGRAMLY_API_KEY = apiKey
  const agent = new PdfAgent(); const command = args[1]; const value = args[2]; if (!value) throw new Error("PDF source or cache id is required")
  if (command === "inspect") { print(await agent.inspect(value)); return }
  if (command === "read") { print((await agent.read(value, flag("--pages"), Number(flag("--cursor") ?? 0), { onProgress: progress })).text); return }
  if (command === "search") { const query = args[3]; if (!query) throw new Error("Search query is required"); print(await agent.search(value, query, flag("--pages"), { onProgress: progress })); return }
  if (command === "parse") { const result = await agent.parse(value, flag("--pages"), { onProgress: progress }); const output = flag("--output") ?? filename(value); await writeFile(output, result.markdown); print({ output, pages: result.pages, cacheId: result.cacheId }); return }
  throw new Error(`Unknown PDF command: ${command}`)
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
