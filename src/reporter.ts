import { writeFileSync } from 'node:fs'
import type { SessionReport } from './types.js'

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'

function c(color: string, text: string, useColor: boolean): string {
  return useColor ? `${color}${text}${RESET}` : text
}

export function renderReport(
  report: SessionReport,
  options: { color: boolean }
): string {
  const color = options.color
  const lines: string[] = []
  const hr = '─'.repeat(50)

  lines.push('')
  lines.push(c(BOLD + CYAN, '┌' + hr + '┐', color))
  lines.push(c(BOLD + CYAN, '│  mcpprof — Session Report', color))
  lines.push(c(BOLD + CYAN, '└' + hr + '┘', color))
  lines.push('')

  // Session summary
  lines.push(c(BOLD, '  Session Summary', color))
  lines.push(c(DIM, '  ' + '─'.repeat(30), color))
  lines.push(`  Duration:       ${formatMs(report.durationMs)}`)
  lines.push(`  Total messages: ${report.totalMessages}`)
  lines.push(`  Client → Server: ${report.clientToServer}`)
  lines.push(`  Server → Client: ${report.serverToClient}`)
  lines.push('')

  // Message breakdown
  lines.push(c(BOLD, '  Message Breakdown', color))
  lines.push(c(DIM, '  ' + '─'.repeat(30), color))
  const cats = Object.entries(report.categories).filter(([, v]) => v > 0)
  cats.sort((a, b) => b[1] - a[1])
  for (const [cat, count] of cats) {
    lines.push(`  ${padRight(cat, 18)} ${count}`)
  }
  lines.push('')

  // Tool call performance
  if (report.toolCalls.total > 0) {
    lines.push(c(BOLD, '  Tool Call Performance', color))
    lines.push(c(DIM, '  ' + '─'.repeat(30), color))
    lines.push(
      `  Total:      ${report.toolCalls.total} (${c(GREEN, `${report.toolCalls.successful} ok`, color)}, ${c(RED, `${report.toolCalls.failed} err`, color)})`
    )
    lines.push(`  Avg latency: ${formatMs(report.toolCalls.avgLatencyMs)}`)
    lines.push(`  p50 latency: ${formatMs(report.toolCalls.p50LatencyMs)}`)
    lines.push(`  p95 latency: ${formatMs(report.toolCalls.p95LatencyMs)}`)
    lines.push('')

    // Per-tool breakdown
    const tools = Object.entries(report.toolCalls.byTool)
    if (tools.length > 0) {
      tools.sort((a, b) => b[1].count - a[1].count)
      lines.push(
        c(DIM, `  ${padRight('Tool', 24)} ${padRight('Calls', 8)} ${padRight('Avg', 10)} Errors`, color)
      )
      for (const [name, stats] of tools) {
        const errStr = stats.errors > 0 ? c(RED, String(stats.errors), color) : c(DIM, '0', color)
        lines.push(
          `  ${padRight(name, 24)} ${padRight(String(stats.count), 8)} ${padRight(formatMs(stats.avgLatencyMs), 10)} ${errStr}`
        )
      }
      lines.push('')
    }
  } else {
    lines.push(c(DIM, '  No tool calls recorded.', color))
    lines.push('')
  }

  return lines.join('\n')
}

export function saveJsonReport(report: SessionReport, path: string): void {
  // Strip timeline raw data to keep JSON manageable
  const slimReport = {
    ...report,
    timeline: report.timeline.map((m) => ({
      direction: m.direction,
      timestamp: m.timestamp,
      method: m.parsed?.method ?? null,
      id: m.parsed?.id ?? null,
      hasError: m.parsed?.error !== undefined,
    })),
  }
  writeFileSync(path, JSON.stringify(slimReport, null, 2))
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length)
}
