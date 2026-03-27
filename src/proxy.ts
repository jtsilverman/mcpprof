import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { parseMessage } from './parser.js'
import type { MCPMessage } from './types.js'

export interface ProxySession {
  events: EventEmitter
  close: () => void
}

export function startProxy(command: string, args: string[]): ProxySession {
  const events = new EventEmitter()

  const server: ChildProcess = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  // Client → Server: read from our stdin, forward to server stdin
  const clientReader = createInterface({ input: process.stdin })
  clientReader.on('line', (line) => {
    const msg: MCPMessage = {
      direction: 'client_to_server',
      timestamp: Date.now(),
      raw: line,
      parsed: parseMessage(line),
    }
    events.emit('message', msg)
    server.stdin!.write(line + '\n')
  })

  // When client stdin closes, close server stdin so it can exit gracefully
  clientReader.on('close', () => {
    server.stdin!.end()
  })

  // Server → Client: read from server stdout, forward to our stdout
  const serverReader = createInterface({ input: server.stdout! })
  serverReader.on('line', (line) => {
    const msg: MCPMessage = {
      direction: 'server_to_client',
      timestamp: Date.now(),
      raw: line,
      parsed: parseMessage(line),
    }
    events.emit('message', msg)
    process.stdout.write(line + '\n')
  })

  // Handle server exit
  server.on('close', (code) => {
    events.emit('close', code)
  })

  server.on('error', (err) => {
    events.emit('error', err)
  })

  // Handle our own process signals
  const cleanup = () => {
    server.kill()
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  return {
    events,
    close: () => {
      clientReader.close()
      serverReader.close()
      server.kill()
      process.removeListener('SIGINT', cleanup)
      process.removeListener('SIGTERM', cleanup)
    },
  }
}
