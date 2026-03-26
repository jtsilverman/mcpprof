# MCP Agent Profiler

## Overview

A CLI tool that sits transparently between any MCP client and server, intercepts all JSON-RPC messages over STDIO, and produces a performance report: tool call latencies, error rates, message counts, and a timeline of the entire session. Think `strace` for MCP. No existing tool does this -- MCP Inspector is a GUI test client, not a production profiler.

## Scope

- **Timebox:** 1.5 days
- **Building:**
  - STDIO proxy that transparently intercepts all JSON-RPC messages between MCP client and server
  - Message parsing and categorization (tools/call, resources/read, prompts/get, notifications, lifecycle)
  - Per-tool-call latency tracking via JSON-RPC request/response ID matching
  - Session summary report on exit (terminal + JSON file)
  - Live mode: print messages as they flow (like `tcpdump`)
  - CLI: `mcpprof -- node my-server.js` (wraps any server command)
  - Installable via `npx mcpprof` or `npm install -g mcpprof`
- **Not building:**
  - HTTP/SSE transport support (STDIO only for MVP)
  - Web dashboard or GUI
  - Token counting or cost estimation
  - Integration with specific MCP clients
  - Message modification or filtering (read-only proxy)
- **Ship target:** npm registry + GitHub

## Project Type

**Pure code** (Node.js CLI tool, no frontend, no agent)

## Stack

- **Language:** TypeScript, Node.js
- **Key deps:** none required (stdlib child_process + readline is sufficient). Optional: chalk for colored output, commander for CLI args.
- **Why:** MCP's official SDK is TypeScript (@modelcontextprotocol/sdk v1.28.0). TypeScript CLI adds portfolio diversity (Jake has Python + React/TS, this is pure Node/TS). Zero external deps for the core proxy keeps it fast and install-friendly.

## Architecture

### Directory Structure

```
mcpprof/
  src/
    index.ts          # CLI entry point, arg parsing
    proxy.ts          # STDIO proxy: spawn server, intercept messages
    parser.ts         # JSON-RPC message parser and categorizer
    tracker.ts        # Latency tracker, request/response matching
    reporter.ts       # Summary report generator (terminal + JSON)
    types.ts          # TypeScript types
  bin/
    mcpprof.js   # Shebang wrapper
  package.json
  tsconfig.json
  README.md
```

### Data Types

```typescript
interface MCPMessage {
  direction: 'client_to_server' | 'server_to_client'
  timestamp: number
  raw: string
  parsed: JsonRpcMessage | null
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string        // present on requests and responses
  method?: string             // present on requests and notifications
  params?: unknown
  result?: unknown            // present on success responses
  error?: { code: number; message: string; data?: unknown }
}

type MessageCategory =
  | 'lifecycle'       // initialize, initialized
  | 'tool_discovery'  // tools/list
  | 'tool_call'       // tools/call
  | 'resource'        // resources/list, resources/read
  | 'prompt'          // prompts/list, prompts/get
  | 'notification'    // notifications/*
  | 'sampling'        // sampling/createMessage
  | 'other'

interface ToolCallRecord {
  id: number | string
  toolName: string
  requestTime: number
  responseTime: number | null
  latencyMs: number | null
  success: boolean
  error?: string
}

interface SessionReport {
  startTime: number
  endTime: number
  durationMs: number
  totalMessages: number
  clientToServer: number
  serverToClient: number
  categories: Record<MessageCategory, number>
  toolCalls: {
    total: number
    successful: number
    failed: number
    avgLatencyMs: number
    p50LatencyMs: number
    p95LatencyMs: number
    byTool: Record<string, {
      count: number
      avgLatencyMs: number
      errors: number
    }>
  }
  timeline: MCPMessage[]  // full message log
}
```

### CLI Interface

```bash
# Basic usage: wrap a server command
mcpprof -- node my-mcp-server.js

# With options
mcpprof --live        -- node server.js   # Print messages as they flow
mcpprof --output report.json -- node server.js   # Save JSON report
mcpprof --quiet       -- node server.js   # No live output, just report at end
mcpprof --no-color    -- node server.js   # Disable colors

# The profiler is transparent: stdin/stdout pass through to the server
# The report prints to stderr so it doesn't interfere with the MCP protocol
```

### Proxy Flow

```
MCP Client (stdin) → [Profiler: log + timestamp] → Server Process (stdin)
Server Process (stdout) → [Profiler: log + match IDs + timestamp] → MCP Client (stdout)
Server Process (stderr) → MCP Client (stderr)  [passthrough, not logged]
```

1. Profiler spawns the server command as a child process
2. Client's stdin is piped through the profiler to the server's stdin
3. Server's stdout is piped through the profiler to the client's stdout
4. Each message is parsed, categorized, and timestamped
5. Request IDs are tracked; when a response arrives with the same ID, latency is calculated
6. On server exit (or SIGINT), the profiler prints the summary report to stderr

## Task List

### Phase 1: Project Setup

#### Task 1.1: Scaffold TypeScript Project
**Files:** `package.json` (create), `tsconfig.json` (create), `src/types.ts` (create), `bin/mcpprof.js` (create)
**Do:** Initialize npm project with name "mcpprof". Configure TypeScript (strict, ES2022, NodeNext module). Define all TypeScript types from the architecture section. Create bin shebang wrapper that requires the compiled entry point. Add build script.
**Validate:** `npm run build` succeeds

### Phase 2: Core Proxy

#### Task 2.1: Message Parser
**Files:** `src/parser.ts` (create)
**Do:** Create `parseMessage(raw: string): JsonRpcMessage | null` that safely parses JSON-RPC. Create `categorizeMessage(msg: JsonRpcMessage): MessageCategory` that maps method names to categories. Handle edge cases: malformed JSON, missing fields, batch messages. Export both functions.
**Validate:** `npm run build && node -e "const p = require('./dist/parser'); console.assert(p.categorizeMessage({method:'tools/call'}) === 'tool_call'); console.assert(p.parseMessage('not json') === null); console.log('PASS')"`

#### Task 2.2: STDIO Proxy
**Files:** `src/proxy.ts` (create)
**Do:** Create `startProxy(command: string, args: string[], options: ProxyOptions): ProxySession`. Spawns the server command as a child process. Reads lines from process.stdin (client side), parses each as JSON-RPC, emits an event, writes to server stdin. Reads lines from server stdout, parses, emits event, writes to process.stdout. Passes server stderr to process.stderr. Uses EventEmitter to expose `message` events with MCPMessage objects. Handles server exit, SIGINT, SIGTERM gracefully. Returns a ProxySession object with an EventEmitter and a close() method.
**Validate:** Create a test script that spawns a simple echo server through the proxy and verifies 3 messages round-trip: `npm run build && node tests/test-proxy.js`

### Phase 3: Tracking and Reporting

#### Task 3.1: Latency Tracker
**Files:** `src/tracker.ts` (create)
**Do:** Create `SessionTracker` class. Methods: `recordMessage(msg: MCPMessage)` -- stores message, if it's a tools/call request, starts tracking the ID. If it's a response matching a tracked ID, calculates latency. `getReport(): SessionReport` -- computes all summary stats (counts, latencies, percentiles, per-tool breakdown). Uses a Map<id, ToolCallRecord> for pending requests. Extracts tool name from `params.name` on tools/call requests.
**Validate:** `npm run build && node tests/test-tracker.js` (test script that feeds mock messages and verifies report output)

#### Task 3.2: Report Renderer
**Files:** `src/reporter.ts` (create)
**Do:** Create `renderReport(report: SessionReport, options: { color: boolean }): string` that formats the report for terminal output. Sections: Session Summary (duration, total messages), Message Breakdown (by category), Tool Call Performance (table with per-tool latency stats, sorted by call count), Errors (if any). Use box-drawing characters for tables. Optional color via ANSI codes. Create `saveJsonReport(report: SessionReport, path: string): void` that writes the full report as formatted JSON.
**Validate:** `npm run build && node tests/test-reporter.js` (feeds a mock report, verifies output contains expected sections)

### Phase 4: CLI Integration

#### Task 4.1: CLI Entry Point
**Files:** `src/index.ts` (create)
**Do:** Parse CLI args: `--live` (print messages as they flow), `--output <path>` (save JSON report), `--quiet` (suppress live output), `--no-color`. Everything after `--` is the server command + args. If no command given, print usage and exit. Wire together: create proxy, create tracker, subscribe to messages, on proxy close render and print report to stderr. In live mode, print each message to stderr as a one-line summary (direction arrow, method/id, truncated params). Handle SIGINT: kill server, print report.
**Validate:** `npm run build && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node dist/index.js -- node -e "require('readline').createInterface({input:process.stdin}).on('line',l=>{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(l).id,result:{}})+'\n');setTimeout(()=>process.exit(0),100)})" 2>&1 | grep -q "Session Summary" && echo "PASS"`

### Phase 5: End-to-End Integration Test

#### Task 5.1: Integration Test Suite
**Files:** `tests/integration.js` (create)
**Do:** Write a comprehensive test that: 1) Creates a mock MCP server (responds to initialize, tools/list, tools/call with realistic data and varied latencies via setTimeout). 2) Runs mcpprof wrapping that mock server. 3) Sends a realistic sequence of MCP messages (initialize, tools/list, multiple tools/call with different tool names, a failed call). 4) Verifies: report contains correct message counts, tool call latencies are > 0, per-tool breakdown matches sent calls, error count matches failed calls, JSON output file is valid. Run the full suite.
**Validate:** `npm run build && node tests/integration.js`

### Phase 6: Ship

#### Task 6.1: README and Package Config
**Files:** `README.md` (create), `package.json` (modify), `.gitignore` (create), `.npmignore` (create)
**Do:** Write portfolio-ready README (problem, demo with terminal screenshot placeholder, how it works, install, usage examples, output format, license). Update package.json: description, keywords (mcp, profiler, agent, debugging), repository, bin field, files field (only dist/ and bin/). Create .gitignore (node_modules, dist). Create .npmignore.
**Validate:** `npm pack --dry-run 2>&1 | head -20`

## The One Hard Thing

**Correctly matching async JSON-RPC request/response pairs across interleaved messages.**

Why it's hard: MCP messages can arrive in any order. A client might send requests with IDs 1, 2, 3, and responses might come back as 2, 1, 3. Notifications have no ID and arrive mixed in. The profiler needs to match each response to its original request to calculate latency, without blocking or reordering the stream.

Proposed approach: Use a Map<RequestId, PendingRequest> that stores the timestamp and metadata when a request is seen. When a response with a matching ID arrives, pop it from the map, calculate latency. Handle edge cases: responses without matching requests (log as orphans), requests that never get responses (report as timeouts on session end).

Fallback: If ID matching proves unreliable for some edge case, fall back to timing-based heuristics (match by proximity) for the report, while still tracking exact counts. Both approaches are independently viable.

## Risks

- **STDIO line buffering (medium):** Some MCP servers might not flush stdout line-by-line. Mitigation: Node's readline handles buffering well, and MCP spec requires newline-delimited JSON-RPC.
- **Message framing (low):** MCP might use content-length framing instead of newline-delimited in some cases. Mitigation: check the spec; if needed, support both modes.
- **npm name availability (low):** "mcpprof" might be taken. Mitigation: check before publishing, alternatives: "@jtsilverman/mcpprof" or "mcpprof".
- **Scope (low):** This is intentionally minimal. Pure proxy with reporting, no UI.
