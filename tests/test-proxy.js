// Test: spawn a mock MCP server through the proxy, verify messages round-trip
import { spawn } from 'node:child_process'

// Mock MCP server: echoes back JSON-RPC responses
const MOCK_SERVER = `
const rl = require('readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1.0' } }
    }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { tools: [{ name: 'test_tool', description: 'A test' }] }
    }) + '\\n');
  } else if (msg.method === 'tools/call') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: msg.id,
      result: { content: [{ type: 'text', text: 'done' }] }
    }) + '\\n');
  }
});
`;

// Run the proxy wrapping our mock server
const proxy = spawn('node', ['dist/index.js', '--', 'node', '-e', MOCK_SERVER], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

const messages = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'test_tool', arguments: {} } },
];

let received = [];
const rl = (await import('node:readline')).createInterface({ input: proxy.stdout });
rl.on('line', (line) => {
  received.push(JSON.parse(line));
  if (received.length === 3) {
    // Verify
    console.assert(received[0].id === 1, 'First response id=1');
    console.assert(received[1].id === 2, 'Second response id=2');
    console.assert(received[2].id === 3, 'Third response id=3');
    console.assert(received[1].result.tools.length === 1, 'Tools list has 1 tool');
    console.log('PASS: 3 messages round-tripped through proxy');
    proxy.kill();
    process.exit(0);
  }
});

// Send messages
for (const msg of messages) {
  proxy.stdin.write(JSON.stringify(msg) + '\n');
}

// Timeout
setTimeout(() => {
  console.error(`FAIL: only received ${received.length}/3 responses`);
  proxy.kill();
  process.exit(1);
}, 5000);
