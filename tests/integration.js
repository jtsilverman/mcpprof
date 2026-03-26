// Full integration test: realistic MCP session through mcpprof
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync, unlinkSync } from 'node:fs'

const MOCK_SERVER = `
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  const id = msg.id;

  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'mock', version: '1.0' } }
    }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id,
      result: { tools: [
        { name: 'search', description: 'Search' },
        { name: 'read_file', description: 'Read' },
      ]}
    }) + '\\n');
  } else if (msg.method === 'tools/call') {
    const toolName = msg.params?.name;
    const delay = toolName === 'search' ? 50 : 20;

    if (toolName === 'read_file' && msg.params?.arguments?.path === 'bad') {
      // Simulate error with delay
      setTimeout(() => {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id,
          error: { code: -1, message: 'File not found' }
        }) + '\\n');
      }, delay);
    } else {
      setTimeout(() => {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: 'result from ' + toolName }] }
        }) + '\\n');
      }, delay);
    }
  } else if (msg.method === 'shutdown') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\\n');
    setTimeout(() => process.exit(0), 50);
  }
});
`;

const REPORT_FILE = '/tmp/mcpprof-test-report.json';

const proxy = spawn('node', [
  'dist/index.js', '--live', '--output', REPORT_FILE,
  '--', 'node', '-e', MOCK_SERVER,
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

const messages = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { query: 'hello' } } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search', arguments: { query: 'world' } } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/tmp/test' } } },
  { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'bad' } } },
  { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search', arguments: { query: 'final' } } },
  { jsonrpc: '2.0', id: 100, method: 'shutdown' },
];

let received = [];
let stderrOutput = '';

const rl = createInterface({ input: proxy.stdout });
rl.on('line', (line) => {
  try { received.push(JSON.parse(line)); } catch {}
});

proxy.stderr.on('data', (chunk) => {
  stderrOutput += chunk.toString();
});

// Send messages with small delays
let idx = 0;
const sendNext = () => {
  if (idx < messages.length) {
    proxy.stdin.write(JSON.stringify(messages[idx]) + '\n');
    idx++;
    setTimeout(sendNext, 80);
  }
};
sendNext();

proxy.on('close', () => {
  let failures = 0;

  // Test 1: All responses received
  const expectedResponses = 7; // init, tools/list, 5 tool calls, shutdown = 7 with IDs
  // Actually: init(1), tools/list(1), search(3), read_file(2), shutdown(1) = 8 minus notification = 7 responses expected? Let me count:
  // id=1 initialize, id=2 tools/list, id=3 search, id=4 search, id=5 read_file, id=6 read_file(err), id=7 search, id=100 shutdown = 8 responses
  if (received.length < 8) {
    console.error(`FAIL: expected 8 responses, got ${received.length}`);
    failures++;
  } else {
    console.log(`  PASS: received ${received.length} responses`);
  }

  // Test 2: Report contains key sections
  if (!stderrOutput.includes('Session Report')) {
    console.error('FAIL: no Session Report in stderr');
    failures++;
  } else {
    console.log('  PASS: Session Report present in stderr');
  }

  // Test 3: Report shows correct tool counts
  if (!stderrOutput.includes('5') || !stderrOutput.includes('search')) {
    console.error('FAIL: tool call stats not in report');
    failures++;
  } else {
    console.log('  PASS: tool call stats present');
  }

  // Test 4: Report shows errors
  if (!stderrOutput.includes('err')) {
    console.error('FAIL: error count not in report');
    failures++;
  } else {
    console.log('  PASS: error count present');
  }

  // Test 5: Live mode shows messages
  if (!stderrOutput.includes('C→S') || !stderrOutput.includes('S→C')) {
    console.error('FAIL: live mode messages not shown');
    failures++;
  } else {
    console.log('  PASS: live mode messages shown');
  }

  // Test 6: JSON report file
  try {
    const jsonReport = JSON.parse(readFileSync(REPORT_FILE, 'utf-8'));
    if (jsonReport.totalMessages < 10) {
      console.error(`FAIL: JSON report totalMessages too low: ${jsonReport.totalMessages}`);
      failures++;
    } else {
      console.log(`  PASS: JSON report valid, ${jsonReport.totalMessages} messages`);
    }
    if (jsonReport.toolCalls.total !== 5) {
      console.error(`FAIL: JSON report tool calls: ${jsonReport.toolCalls.total}, expected 5`);
      failures++;
    } else {
      console.log('  PASS: JSON report tool call count correct');
    }
    if (jsonReport.toolCalls.failed !== 1) {
      console.error(`FAIL: JSON report failed calls: ${jsonReport.toolCalls.failed}, expected 1`);
      failures++;
    } else {
      console.log('  PASS: JSON report error count correct');
    }
    if (jsonReport.toolCalls.avgLatencyMs <= 0) {
      console.error(`FAIL: JSON report avg latency: ${jsonReport.toolCalls.avgLatencyMs}`);
      failures++;
    } else {
      console.log(`  PASS: JSON report avg latency: ${Math.round(jsonReport.toolCalls.avgLatencyMs)}ms`);
    }
    unlinkSync(REPORT_FILE);
  } catch (e) {
    console.error(`FAIL: JSON report not readable: ${e.message}`);
    failures++;
  }

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\nPASS: all integration tests');
    process.exit(0);
  }
});

// Timeout
setTimeout(() => {
  console.error('FAIL: test timed out');
  proxy.kill();
  process.exit(1);
}, 15000);
