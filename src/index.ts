/**
 * dsh-ahoy 宿主插件。
 *
 * 两个 profile 用 127.0.0.1 直接互连。DSH_AHOY_LISTEN 是本机监听端口。
 * 对方地址用 DSH_AHOY_PEERS，或 profile 目录里的 ahoy-peers.json。
 * 不要加转发进程，也不要走 SSH。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAhoyTool } from './ahoy-tool'
import { cancelRemote, followRemote, listWithPeers, pageRemote, projectionRemote, promptRemote } from './attach'
import { loadPeerUrls } from './peers'
import { readPeer, sessionsFromHost, startPeer, type SessionBridge } from './peer'

export { createAhoyTool, delegateToPeer, resolvePeer } from './ahoy-tool'
export { setPeerToken } from './peers'
export { pagePeer, promptPeer, readPeer, sessionsFromHost, startPeer } from './peer'

interface ToolsFace {
  register(tool: ReturnType<typeof createAhoyTool>): () => void
}

interface WebServer {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void
  }): () => void
}

interface HostContext {
  effect(dispose: () => void, label: string): void
  get?(name: string): unknown
  tools?: ToolsFace
  webServer?: WebServer
  sessionController?: Parameters<typeof sessionsFromHost>[0]['sessionController']
}

function optionalService<T>(ctx: HostContext, name: string): T | undefined {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
  return undefined
}

function peerList(): string[] {
  return loadPeerUrls()
}

function registerTree(ctx: HostContext): void {
  const webServer = optionalService<WebServer>(ctx, 'webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return
  const dispose = webServer.register({
    kind: 'exact',
    path: '/ahoy/tree',
    handler(_request, response) {
      void (async () => {
        const machines: {
          peer: string
          cpuPercent: number | null
          memoryUsedBytes: number | null
          memoryTotalBytes: number | null
          diskUsedBytes: number | null
          diskTotalBytes: number | null
          sessions: { sessionId: string, title: string }[]
          error?: string
        }[] = []
        const sessions: { peer: string, sessionId: string, title: string }[] = []
        for (const peer of peerList()) {
          try {
            const status = await readPeer(peer)
            const rows = status.sessions.map(session => ({ sessionId: session.sessionId, title: session.title }))
            machines.push({
              peer,
              cpuPercent: status.cpuPercent,
              memoryUsedBytes: status.memoryUsedBytes,
              memoryTotalBytes: status.memoryTotalBytes,
              diskUsedBytes: status.diskUsedBytes,
              diskTotalBytes: status.diskTotalBytes,
              sessions: rows,
            })
            for (const session of rows) sessions.push({ peer, ...session })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            machines.push({
              peer,
              cpuPercent: null,
              memoryUsedBytes: null,
              memoryTotalBytes: null,
              diskUsedBytes: null,
              diskTotalBytes: null,
              sessions: [],
              error: message,
            })
          }
        }
        const body = JSON.stringify({ machines, sessions })
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        })
        response.end(body)
      })()
    },
  })
  ctx.effect(() => dispose, 'dsh-ahoy: tree')
}

export const name = 'dsh-ahoy'

/** 会话服务和工具服务都到齐后再启动。Cordis 不允许读取没有声明的服务。 */
export const inject = ['sessionController', 'tools']

function installOfficialAttach(ctx: HostContext): void {
  const peers = peerList()
  if (peers.length === 0) return
  const controller = (typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined) ?? ctx.sessionController
  const face = controller as {
    list?: (request: unknown, signal: AbortSignal) => Promise<{ items?: readonly { sessionId?: string }[] }>
    prompt?: (request: { sessionId: string, content?: readonly { type?: string, text?: string }[] }, signal: AbortSignal) => Promise<unknown>
    page?: (request: { address?: { kind?: string, sessionId?: string } }, signal: AbortSignal) => Promise<unknown>
    events?: (request: { address?: { kind?: string, sessionId?: string } }, signal: AbortSignal) => Promise<unknown>
    cancel?: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
    projections?: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
    follow?: (request: { address?: { kind?: string, sessionId?: string } }, signal: AbortSignal) => AsyncIterable<unknown>
  } | undefined
  if (face === undefined || typeof face.list !== 'function' || typeof face.prompt !== 'function') return
  const originalList = face.list.bind(face)
  const originalPrompt = face.prompt.bind(face)
  const originalCancel = typeof face.cancel === 'function' ? face.cancel.bind(face) : undefined
  const originalProjections = typeof face.projections === 'function' ? face.projections.bind(face) : undefined
  const originalFollow = typeof face.follow === 'function' ? face.follow.bind(face) : undefined
  console.error(`[dsh-ahoy] 官方会话列表会带上 ${peers.length} 个对方地址`)
  face.list = async (request, signal) => listWithPeers(await originalList(request, signal) as { items?: { sessionId: string }[] }, peers)
  face.prompt = async (request, signal) => {
    const forwarded = await promptRemote(request)
    if (forwarded !== undefined) return forwarded
    return originalPrompt(request, signal)
  }
  if (originalFollow !== undefined) {
    face.follow = (request, signal) => {
      const sessionId = request.address?.kind === 'session' ? request.address.sessionId : undefined
      if (typeof sessionId === 'string' && sessionId.startsWith('ahoy:')) {
        return followRemote(sessionId, request, signal)
      }
      return originalFollow(request, signal)
    }
  }
  if (originalProjections !== undefined) {
    face.projections = async (request, signal) => {
      const forwarded = await projectionRemote(request.sessionId)
      if (forwarded !== undefined) return forwarded
      return originalProjections(request, signal)
    }
  }
  if (originalCancel !== undefined) {
    face.cancel = async (request, signal) => {
      const forwarded = await cancelRemote(request.sessionId)
      if (forwarded !== undefined) return forwarded
      return originalCancel(request, signal)
    }
  }
  const wrapPage = (original: (request: { address?: { kind?: string, sessionId?: string } }, signal: AbortSignal) => Promise<unknown>) =>
    async (request: { address?: { kind?: string, sessionId?: string } }, signal: AbortSignal) => {
      const sessionId = request.address?.kind === 'session' ? request.address.sessionId : undefined
      if (typeof sessionId === 'string') {
        const forwarded = await pageRemote(sessionId, request)
        if (forwarded !== undefined) return forwarded
      }
      return original(request, signal)
    }
  const originalPage = typeof face.page === 'function' ? face.page.bind(face) : undefined
  const originalEvents = typeof face.events === 'function' ? face.events.bind(face) : undefined
  if (originalPage !== undefined) face.page = wrapPage(originalPage)
  if (originalEvents !== undefined) face.events = wrapPage(originalEvents)
  ctx.effect(() => () => {
    face.list = originalList
    face.prompt = originalPrompt
    if (originalCancel !== undefined) face.cancel = originalCancel
    if (originalProjections !== undefined) face.projections = originalProjections
    if (originalFollow !== undefined) face.follow = originalFollow
    if (originalPage !== undefined) face.page = originalPage
    if (originalEvents !== undefined) face.events = originalEvents
  }, 'dsh-ahoy: attach')
}

export function apply(ctx: HostContext): void {
  registerTree(ctx)
  const bridge: SessionBridge = sessionsFromHost(ctx)
  installOfficialAttach(ctx)
  const listen = process.env.DSH_AHOY_LISTEN
  let closePeer: (() => Promise<void>) | undefined
  let stopped = false
  if (listen !== undefined && listen !== '') {
    const port = Number(listen)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`DSH_AHOY_LISTEN 不是端口: ${listen}`)
    }
    const expiresText = process.env.DSH_AHOY_TOKEN_EXPIRES
  const expiresAt = expiresText !== undefined && expiresText !== '' ? Number(expiresText) : undefined
  void startPeer(port, bridge, {
    token: process.env.DSH_AHOY_TOKEN,
    expiresAt: expiresAt !== undefined && Number.isFinite(expiresAt) ? expiresAt : undefined,
  }).then(handle => {
      if (stopped) {
        void handle.close()
        return
      }
      closePeer = handle.close
    }, error => {
      console.error('[dsh-ahoy] 本机监听失败:', error)
    })
    ctx.effect(() => () => {
      stopped = true
      void closePeer?.()
    }, 'dsh-ahoy: peer')
  } else {
    ctx.effect(() => () => {}, 'dsh-ahoy: idle')
  }

  const tools = (typeof ctx.get === 'function' ? ctx.get('tools') : undefined) ?? ctx.tools
  const face = tools as ToolsFace | undefined
  if (face !== undefined && typeof face.register === 'function') {
    const dispose = face.register(createAhoyTool(peerList))
    ctx.effect(() => dispose, 'dsh-ahoy: tool')
  }

}
