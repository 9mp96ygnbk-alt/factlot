#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./index.ts";

// The stdio server runs on the user's machine, so it may read local files (doc_read_pdf).
const server = createServer({ localFiles: true });
await server.connect(new StdioServerTransport());
