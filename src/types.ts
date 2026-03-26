export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface MCPMessage {
  direction: 'client_to_server' | 'server_to_client'
  timestamp: number
  raw: string
  parsed: JsonRpcMessage | null
}

export type MessageCategory =
  | 'lifecycle'
  | 'tool_discovery'
  | 'tool_call'
  | 'resource'
  | 'prompt'
  | 'notification'
  | 'sampling'
  | 'other'

export interface ToolCallRecord {
  id: number | string
  toolName: string
  requestTime: number
  responseTime: number | null
  latencyMs: number | null
  success: boolean
  error?: string
}

export interface ToolStats {
  count: number
  avgLatencyMs: number
  errors: number
}

export interface SessionReport {
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
    byTool: Record<string, ToolStats>
  }
  timeline: MCPMessage[]
}

export interface ProxyOptions {
  live: boolean
  quiet: boolean
  color: boolean
  output: string | null
}
