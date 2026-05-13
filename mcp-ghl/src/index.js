#!/usr/bin/env node
// MCP server exposing GoHighLevel (v2 API) to Claude.
// Transport: stdio. Auth: Private Integration Token via GHL_PIT env var.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { contactTools } from "./tools/contacts.js";
import { conversationTools } from "./tools/conversations.js";
import { calendarTools } from "./tools/calendars.js";
import { opportunityTools } from "./tools/opportunities.js";
import { locationTools } from "./tools/location.js";
import { workflowTools } from "./tools/workflows.js";
import { genericTools } from "./tools/generic.js";

const ALL_TOOLS = [
  ...contactTools,
  ...conversationTools,
  ...calendarTools,
  ...opportunityTools,
  ...locationTools,
  ...workflowTools,
  ...genericTools,
];

function toContent(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function toErrorContent(err) {
  const msg = err && err.message ? err.message : String(err);
  return { content: [{ type: "text", text: msg }], isError: true };
}

async function main() {
  if (!process.env.GHL_PIT) {
    // Don't throw — let the server boot so `tools/list` works for inspection.
    // Each tool call will throw a clear error from ghl.js.
    process.stderr.write(
      "mcp-ghl: warning — GHL_PIT env var is not set. Tool calls will fail until it is provided.\n",
    );
  }

  const server = new McpServer({ name: "mcp-ghl", version: "0.1.0" });

  for (const t of ALL_TOOLS) {
    // Tool schemas are defined with z.object({...}). McpServer.tool() expects
    // the underlying shape (a plain object of zod field schemas), so pass .shape.
    server.tool(t.name, t.description, t.schema.shape, async (args) => {
      try {
        const result = await t.handler(args);
        return toContent(result);
      } catch (err) {
        return toErrorContent(err);
      }
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`mcp-ghl fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
