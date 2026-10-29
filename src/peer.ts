import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readMachineStatus, type MachineStatus } from './metrics'

export interface RemoteSession {
  sessionId: string
  title: string
}

export interface PromptResult {
  accepted: true
  sessionId: string
}

export interface SessionBridge {
  list(): Promise<RemoteSession[]>
  prompt(sessionId: string, text: string): Promise<PromptResult>
}

export interface PeerStatus extends MachineStatus {
  sessions: RemoteSession[]
}

interface PeerHandle {
  port: number
  close(): Promise<void>
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function remoteAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? ''
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

/** 只接受本机连进来。这是两个插件直接说话，不是转发。 */
export function startPeer(port: number, sessions: SessionBridge): Promise<PeerHandle> {
  const server: Server = createServer((request, response) => {
    void handle(request, response, sessions)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('peer did not bind a TCP port'))
        return
      }
      resolve({
        port: (address as AddressInfo).port,
        close: () => new Promise((done, fail) => {
          server.close(error => error ? fail(error) : done())
        }),
      })
    })
  })
}

async function handle(request: IncomingMessage, response: ServerResponse, sessions: SessionBridge): Promise<void> {
  const address = remoteAddress(request)
  if (address !== '127.0.0.1' && address !== '::1') {
    sendJson(response, 403, { error: 'only loopback clients are accepted' })
    return
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'POST only' })
    return
  }
  try {
    if (request.url === '/v1/status') {
      sendJson(response, 200, { ...readMachineStatus(), sessions: await sessions.list() })
      return
    }
    if (request.url === '/v1/prompt') {
      const body = JSON.parse(await readBody(request)) as { sessionId?: unknown, text?: unknown }
      if (typeof body.sessionId !== 'string' || typeof body.text !== 'string' || body.text.trim() === '') {
        sendJson(response, 400, { error: 'sessionId and text are required' })
        return
      }
      sendJson(response, 200, await sessions.prompt(body.sessionId, body.text))
      return
    }
    sendJson(response, 404, { error: 'not found' })
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}

export async function readPeer(baseUrl: string): Promise<PeerStatus> {
  const response = await fetch(new URL('/v1/status', baseUrl), { method: 'POST' })
  if (!response.ok) throw new Error(`peer status failed: ${response.status}`)
  return await response.json() as PeerStatus
}

export async function promptPeer(baseUrl: string, sessionId: string, text: string): Promise<PromptResult> {
  const response = await fetch(new URL('/v1/prompt', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  })
  if (!response.ok) throw new Error(`peer prompt failed: ${response.status}`)
  return await response.json() as PromptResult
}

interface SessionControllerLike {
  list(request: { cursor?: string }, signal: AbortSignal): Promise<{ items?: readonly { sessionId?: string, title?: string }[] }>
  prompt(request: {
    sessionId: string
    content: readonly { type: 'text', text: string }[]
    mode: 'queue'
    requestId: string
  }, signal: AbortSignal): Promise<unknown>
}

interface HostWithSessions {
  get?(name: string): unknown
  sessionController?: SessionControllerLike
}

/** 对方插件调用它所在的那台 DSH。没有会话服务时列表为空，送消息会失败。 */
export function sessionsFromHost(ctx: HostWithSessions): SessionBridge {
  const controller = (typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined) ?? ctx.sessionController
  const face = controller as SessionControllerLike | undefined
  const list = face !== undefined && typeof face.list === 'function' ? face.list.bind(face) : undefined
  const prompt = face !== undefined && typeof face.prompt === 'function' ? face.prompt.bind(face) : undefined
  return {
    async list() {
      if (list === undefined) return []
      const value = await list({}, new AbortController().signal)
      return (value.items ?? []).flatMap(item => {
        if (typeof item.sessionId !== 'string') return []
        return [{ sessionId: item.sessionId, title: typeof item.title === 'string' ? item.title : item.sessionId }]
      })
    },
    async prompt(sessionId, text) {
      if (prompt === undefined) {
        throw new Error('这台 DSH 没有会话接口')
      }
      await prompt({
        sessionId,
        content: [{ type: 'text', text }],
        mode: 'queue',
        requestId: crypto.randomUUID(),
      }, new AbortController().signal)
      return { accepted: true, sessionId }
    },
  }
}
