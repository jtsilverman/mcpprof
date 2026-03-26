import { SessionTracker } from '../dist/tracker.js'

const tracker = new SessionTracker()

const now = Date.now()

// Simulate: initialize request/response
tracker.recordMessage({
  direction: 'client_to_server', timestamp: now,
  raw: '', parsed: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }
})
tracker.recordMessage({
  direction: 'server_to_client', timestamp: now + 10,
  raw: '', parsed: { jsonrpc: '2.0', id: 1, result: {} }
})

// Simulate: tools/list
tracker.recordMessage({
  direction: 'client_to_server', timestamp: now + 20,
  raw: '', parsed: { jsonrpc: '2.0', id: 2, method: 'tools/list' }
})
tracker.recordMessage({
  direction: 'server_to_client', timestamp: now + 30,
  raw: '', parsed: { jsonrpc: '2.0', id: 2, result: { tools: [] } }
})

// Simulate: 3 tool calls with different latencies
tracker.recordMessage({
  direction: 'client_to_server', timestamp: now + 100,
  raw: '', parsed: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search' } }
})
tracker.recordMessage({
  direction: 'server_to_client', timestamp: now + 200,
  raw: '', parsed: { jsonrpc: '2.0', id: 3, result: { content: [] } }
})

tracker.recordMessage({
  direction: 'client_to_server', timestamp: now + 300,
  raw: '', parsed: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search' } }
})
tracker.recordMessage({
  direction: 'server_to_client', timestamp: now + 350,
  raw: '', parsed: { jsonrpc: '2.0', id: 4, result: { content: [] } }
})

tracker.recordMessage({
  direction: 'client_to_server', timestamp: now + 400,
  raw: '', parsed: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_file' } }
})
tracker.recordMessage({
  direction: 'server_to_client', timestamp: now + 420,
  raw: '', parsed: { jsonrpc: '2.0', id: 5, error: { code: -1, message: 'Not found' } }
})

// Simulate: notification (no id)
tracker.recordMessage({
  direction: 'server_to_client', timestamp: now + 500,
  raw: '', parsed: { jsonrpc: '2.0', method: 'notifications/tools/list_changed' }
})

const report = tracker.getReport()

// Verify counts
console.assert(report.totalMessages === 11, `totalMessages: ${report.totalMessages}`)
console.assert(report.clientToServer === 5, `c2s: ${report.clientToServer}`)
console.assert(report.serverToClient === 6, `s2c: ${report.serverToClient}`)

// Verify categories
console.assert(report.categories.lifecycle === 1, `lifecycle: ${report.categories.lifecycle}`)
console.assert(report.categories.tool_discovery === 1, `tool_discovery: ${report.categories.tool_discovery}`)
console.assert(report.categories.tool_call === 3, `tool_call: ${report.categories.tool_call}`)
console.assert(report.categories.notification === 1, `notification: ${report.categories.notification}`)

// Verify tool calls
console.assert(report.toolCalls.total === 3, `total tools: ${report.toolCalls.total}`)
console.assert(report.toolCalls.successful === 2, `successful: ${report.toolCalls.successful}`)
console.assert(report.toolCalls.failed === 1, `failed: ${report.toolCalls.failed}`)
console.assert(report.toolCalls.avgLatencyMs === 75, `avg latency: ${report.toolCalls.avgLatencyMs}`)

// Verify per-tool breakdown
console.assert(report.toolCalls.byTool['search'].count === 2, 'search count')
console.assert(report.toolCalls.byTool['read_file'].count === 1, 'read_file count')
console.assert(report.toolCalls.byTool['read_file'].errors === 1, 'read_file errors')

console.log('PASS: all tracker tests')
