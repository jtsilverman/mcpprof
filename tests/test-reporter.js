import { renderReport } from '../dist/reporter.js'

const mockReport = {
  startTime: 1000,
  endTime: 5000,
  durationMs: 4000,
  totalMessages: 20,
  clientToServer: 10,
  serverToClient: 10,
  categories: {
    lifecycle: 2, tool_discovery: 1, tool_call: 5,
    resource: 1, prompt: 0, notification: 1, sampling: 0, other: 0,
  },
  toolCalls: {
    total: 5,
    successful: 4,
    failed: 1,
    avgLatencyMs: 120,
    p50LatencyMs: 100,
    p95LatencyMs: 250,
    byTool: {
      search: { count: 3, avgLatencyMs: 100, errors: 0 },
      write_file: { count: 2, avgLatencyMs: 150, errors: 1 },
    },
  },
  timeline: [],
}

const output = renderReport(mockReport, { color: false })

console.assert(output.includes('Session Report'), 'Has title')
console.assert(output.includes('4000ms') || output.includes('4.00s'), 'Has duration')
console.assert(output.includes('20'), 'Has total messages')
console.assert(output.includes('tool_call'), 'Has category')
console.assert(output.includes('search'), 'Has tool name')
console.assert(output.includes('write_file'), 'Has second tool')
console.assert(output.includes('4 ok'), 'Has success count')
console.assert(output.includes('1 err'), 'Has error count')
console.assert(output.includes('p50'), 'Has p50')
console.assert(output.includes('p95'), 'Has p95')

console.log('PASS: all reporter tests')
