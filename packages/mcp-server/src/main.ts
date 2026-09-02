#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { PdfAgent } from "@engramly/agent-core"
import type { PdfProgress } from "@engramly/engram"

const server = new McpServer({ name: "engramly-parse", version: "0.1.0" }); const agent = new PdfAgent()
const output = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], structuredContent: value as Record<string, unknown> })
const notify = (extra: { _meta?: { progressToken?: string | number }; sendNotification: (value: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total: number; message: string } }) => Promise<void> }) => {
  const token = extra._meta?.progressToken
  if (token === undefined) return undefined
  return (event: PdfProgress) => extra.sendNotification({
    method: "notifications/progress",
    params: {
      progressToken: token, total: 2,
      progress: event.phase === "prepare" && event.state === "started" ? 0 : event.phase === "prepare" || event.state === "started" ? 1 : 2,
      message: `${event.phase}:${event.state}${event.pages ? ` (${event.pages} pages)` : ""}`,
    },
  })
}
server.registerTool("inspect_pdf", { description: "Inspect PDF page count, metadata, and outline before reading a large document.", inputSchema: { source: z.string().describe("Absolute local path or HTTPS URL") } }, async ({ source }) => output(await agent.inspect(source)))
server.registerTool("read_pdf", { description: "Read selected PDF pages as high-fidelity Markdown with a bounded response.", inputSchema: { source: z.string().describe("Absolute path, HTTPS URL, or cache id"), pages: z.string().optional(), cursor: z.number().int().nonnegative().optional() } }, async (input, extra) => output(await agent.read(input.source, input.pages, input.cursor, { onProgress: notify(extra) })))
server.registerTool("search_pdf", { description: "Search cached parsed PDF pages and return bounded page-numbered excerpts.", inputSchema: { source: z.string(), query: z.string(), pages: z.string().optional() } }, async (input, extra) => output(await agent.search(input.source, input.query, input.pages, { onProgress: notify(extra) })))
await server.connect(new StdioServerTransport())
