import type { JsonRpcMessage, MessageCategory } from './types.js'

export function parseMessage(raw: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    if (parsed.jsonrpc !== '2.0') return null
    return parsed as JsonRpcMessage
  } catch {
    return null
  }
}

const METHOD_CATEGORIES: [RegExp, MessageCategory][] = [
  [/^initialize$/, 'lifecycle'],
  [/^notifications\/initialized$/, 'lifecycle'],
  [/^shutdown$/, 'lifecycle'],
  [/^tools\/list$/, 'tool_discovery'],
  [/^tools\/call$/, 'tool_call'],
  [/^resources\//, 'resource'],
  [/^prompts\//, 'prompt'],
  [/^notifications\//, 'notification'],
  [/^sampling\//, 'sampling'],
]

export function categorizeMessage(msg: JsonRpcMessage): MessageCategory {
  if (!msg.method) {
    // It's a response — categorize as 'other' (tracker handles matching)
    return 'other'
  }
  for (const [pattern, category] of METHOD_CATEGORIES) {
    if (pattern.test(msg.method)) return category
  }
  return 'other'
}
