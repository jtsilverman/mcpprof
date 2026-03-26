import { categorizeMessage } from './parser.js'
import type {
  MCPMessage,
  MessageCategory,
  ToolCallRecord,
  SessionReport,
} from './types.js'

interface PendingRequest {
  id: number | string
  method: string
  toolName: string
  timestamp: number
  category: MessageCategory
}

export class SessionTracker {
  private messages: MCPMessage[] = []
  private pending = new Map<string | number, PendingRequest>()
  private toolCalls: ToolCallRecord[] = []
  private categories: Record<MessageCategory, number> = {
    lifecycle: 0,
    tool_discovery: 0,
    tool_call: 0,
    resource: 0,
    prompt: 0,
    notification: 0,
    sampling: 0,
    other: 0,
  }
  private startTime = Date.now()

  recordMessage(msg: MCPMessage): void {
    this.messages.push(msg)
    const parsed = msg.parsed
    if (!parsed) return

    if (msg.direction === 'client_to_server' && parsed.method) {
      // It's a request or notification from client
      const category = categorizeMessage(parsed)
      this.categories[category]++

      if (parsed.id !== undefined) {
        const toolName =
          parsed.method === 'tools/call' && parsed.params
            ? (parsed.params as { name?: string }).name ?? 'unknown'
            : ''
        this.pending.set(parsed.id, {
          id: parsed.id,
          method: parsed.method,
          toolName,
          timestamp: msg.timestamp,
          category,
        })
      }
    } else if (msg.direction === 'server_to_client') {
      if (parsed.method) {
        // Server-initiated notification or request
        const category = categorizeMessage(parsed)
        this.categories[category]++
      } else if (parsed.id !== undefined) {
        // Response — match to pending request
        const req = this.pending.get(parsed.id)
        if (req) {
          this.pending.delete(parsed.id)
          // Count the response under the request's category
          // (the request was already counted)

          if (req.category === 'tool_call') {
            const latency = msg.timestamp - req.timestamp
            const hasError = parsed.error !== undefined
            this.toolCalls.push({
              id: req.id,
              toolName: req.toolName,
              requestTime: req.timestamp,
              responseTime: msg.timestamp,
              latencyMs: latency,
              success: !hasError,
              error: hasError ? parsed.error!.message : undefined,
            })
          }
        } else {
          this.categories.other++
        }
      }
    }
  }

  getReport(): SessionReport {
    const endTime = Date.now()
    const clientToServer = this.messages.filter(
      (m) => m.direction === 'client_to_server'
    ).length
    const serverToClient = this.messages.filter(
      (m) => m.direction === 'server_to_client'
    ).length

    // Mark pending requests as timed out
    for (const req of this.pending.values()) {
      if (req.category === 'tool_call') {
        this.toolCalls.push({
          id: req.id,
          toolName: req.toolName,
          requestTime: req.timestamp,
          responseTime: null,
          latencyMs: null,
          success: false,
          error: 'No response (timeout)',
        })
      }
    }

    const successful = this.toolCalls.filter((t) => t.success)
    const failed = this.toolCalls.filter((t) => !t.success)
    const latencies = successful
      .map((t) => t.latencyMs!)
      .sort((a, b) => a - b)

    const byTool: Record<string, { count: number; avgLatencyMs: number; errors: number }> = {}
    for (const tc of this.toolCalls) {
      if (!byTool[tc.toolName]) {
        byTool[tc.toolName] = { count: 0, avgLatencyMs: 0, errors: 0 }
      }
      byTool[tc.toolName].count++
      if (!tc.success) byTool[tc.toolName].errors++
    }
    // Calculate avg latency per tool
    for (const tc of successful) {
      if (byTool[tc.toolName]) {
        const tool = byTool[tc.toolName]
        const successCount = tool.count - tool.errors
        if (successCount > 0) {
          tool.avgLatencyMs += tc.latencyMs! / successCount
        }
      }
    }

    return {
      startTime: this.startTime,
      endTime,
      durationMs: endTime - this.startTime,
      totalMessages: this.messages.length,
      clientToServer,
      serverToClient,
      categories: { ...this.categories },
      toolCalls: {
        total: this.toolCalls.length,
        successful: successful.length,
        failed: failed.length,
        avgLatencyMs: latencies.length
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0,
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
        byTool,
      },
      timeline: this.messages,
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}
