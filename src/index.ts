import { startProxy } from './proxy.js'
import { SessionTracker } from './tracker.js'
import { renderReport, saveJsonReport } from './reporter.js'
import { categorizeMessage } from './parser.js'
import type { MCPMessage, ProxyOptions } from './types.js'

function parseArgs(argv: string[]): { options: ProxyOptions; command: string; args: string[] } {
  const raw = argv.slice(2)
  const sepIdx = raw.indexOf('--')

  if (sepIdx === -1 || sepIdx === raw.length - 1) {
    process.stderr.write(
      `Usage: mcpprof [options] -- <server-command> [args...]

Options:
  --live       Print messages as they flow (like tcpdump)
  --quiet      Suppress live output, only show report at end
  --no-color   Disable colored output
  --output <f> Save JSON report to file

Examples:
  mcpprof -- node my-mcp-server.js
  mcpprof --live -- python server.py
  mcpprof --output report.json -- npx @modelcontextprotocol/server-filesystem /tmp
`
    )
    process.exit(1)
  }

  const flags = raw.slice(0, sepIdx)
  const command = raw[sepIdx + 1]
  const args = raw.slice(sepIdx + 2)

  let output: string | null = null
  const outputIdx = flags.indexOf('--output')
  if (outputIdx !== -1 && outputIdx + 1 < flags.length) {
    output = flags[outputIdx + 1]
  }

  return {
    options: {
      live: flags.includes('--live'),
      quiet: flags.includes('--quiet'),
      color: !flags.includes('--no-color') && process.stderr.isTTY !== false,
      output,
    },
    command,
    args,
  }
}

const DIRECTION_ARROW = {
  client_to_server: '→',
  server_to_client: '←',
} as const

function formatLiveMessage(msg: MCPMessage, color: boolean): string {
  const arrow = DIRECTION_ARROW[msg.direction]
  const dir = msg.direction === 'client_to_server' ? 'C→S' : 'S→C'
  const parsed = msg.parsed

  if (!parsed) return `${dir} ${arrow} [unparseable]`

  if (parsed.method) {
    const category = categorizeMessage(parsed)
    const idStr = parsed.id !== undefined ? ` #${parsed.id}` : ''
    const paramsPreview = parsed.params
      ? ` ${JSON.stringify(parsed.params).slice(0, 60)}`
      : ''
    return `${dir} ${arrow} ${parsed.method}${idStr} ${category}${paramsPreview}`
  }

  // Response
  const idStr = parsed.id !== undefined ? `#${parsed.id}` : '?'
  if (parsed.error) {
    const errMsg = parsed.error.message.slice(0, 50)
    return `${dir} ${arrow} ${idStr} ERR: ${errMsg}`
  }
  const resultPreview = parsed.result
    ? JSON.stringify(parsed.result).slice(0, 60)
    : 'null'
  return `${dir} ${arrow} ${idStr} ok ${resultPreview}`
}

function main() {
  const { options, command, args } = parseArgs(process.argv)
  const tracker = new SessionTracker()
  const session = startProxy(command, args)

  session.events.on('message', (msg: MCPMessage) => {
    tracker.recordMessage(msg)

    if (options.live && !options.quiet) {
      const line = formatLiveMessage(msg, options.color)
      process.stderr.write(`  ${line}\n`)
    }
  })

  const printReport = () => {
    const report = tracker.getReport()
    process.stderr.write(renderReport(report, { color: options.color }))
    if (options.output) {
      saveJsonReport(report, options.output)
      process.stderr.write(`\n  JSON report saved to ${options.output}\n\n`)
    }
  }

  session.events.on('close', () => {
    printReport()
    process.exit(0)
  })

  session.events.on('error', (err: Error) => {
    process.stderr.write(`\nmcpprof: server error: ${err.message}\n`)
    printReport()
    process.exit(1)
  })

  // Handle SIGINT gracefully
  process.on('SIGINT', () => {
    printReport()
    session.close()
    process.exit(0)
  })
}

main()
