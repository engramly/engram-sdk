#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { PdfAgent } from "@engramly/agent-core"

const server = new McpServer({ name: "engramly-parse", version: "0.1.0" }); const agent = new PdfAgent()
const output = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], structuredContent: value as Record<string, unknown> })
server.registerTool("inspect_pdf", { description: "Inspect PDF page count, metadata, and outline before reading a large document.", inputSchema: { source: z.string().describe("Absolute local path or HTTPS URL") } }, async ({ source }) => output(await agent.inspect(source)))
server.registerTool("read_pdf", { description: "Read selected PDF pages as high-fidelity Markdown with a bounded response.", inputSchema: { source: z.string().describe("Absolute path, HTTPS URL, or cache id"), pages: z.string().optional(), cursor: z.number().int().nonnegative().optional() } }, async input => output(await agent.read(input.source, input.pages, input.cursor)))
server.registerTool("search_pdf", { description: "Search cached parsed PDF pages and return bounded page-numbered excerpts.", inputSchema: { source: z.string(), query: z.string(), pages: z.string().optional() } }, async input => output(await agent.search(input.source, input.query, input.pages)))
await server.connect(new StdioServerTransport())
