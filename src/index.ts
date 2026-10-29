/**
 * dsh-ahoy 宿主插件。
 *
 * 两个 profile 用 127.0.0.1 直接互连。DSH_AHOY_LISTEN 是本机监听端口。
 * 对方地址用 DSH_AHOY_PEERS，或 profile 目录里的 ahoy-peers.json。
 * 不要加转发进程，也不要走 SSH。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAhoyTool } from './ahoy-tool'
import { ApprovalDesk, isApprovalOutcome, sessionIdFromApproval } from './approval'
import { attachmentRemote, cancelRemote, followRemote, forkRemote, listWithPeers, modelRemote, pageRemote, projectionRemote, promptRemote, queueRemote, renameRemote, searchWithPeers } from './attach'
import { loadListenPort, loadPeerUrls } from './peers'
import { answerPeer, approvalsPeer, readPeer, sessionsFromHost, startPeer, type SessionBridge } from './peer'

export { createAhoyTool, delegateToPeer, resolvePeer } from './ahoy-tool'
export { setPeerToken } from './peers'
export { ApprovalDesk, sessionIdFromApproval } from './approval'
export { answerPeer, approvalsPeer, pagePeer, promptPeer, readPeer, sessionsFromHost, startPeer } from './peer'

interface ToolsFace {
  register(tool: ReturnType<typeof createAhoyTool>): () => void
  get?(name: string): unknown
}

interface WebServer {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void
  }): () => void
}

interface ApprovalRequest {
  toolName?: unknown
  reason?: unknown
  agent?: { session?: { id?: unknown, header?: { id?: unknown } } }
}

interface HostContext {
  effect(dispose: () => void, label: string): void
  get?(name: string): unknown
  on?(event: string, listener: (this: unknown, request: ApprovalRequest, next: () => unknown) => unknown): () => void
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
    rename?: (request: { sessionId: string, title: string }, signal: AbortSignal) => Promise<unknown>
    updateQueue?: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
    selectModel?: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
    fork?: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
    attachment?: (request: { sessionId: string }, signal: AbortSignal) => Promise<unknown>
    search?: (request: { query?: string }, signal: AbortSignal) => Promise<{ items?: { sessionId?: string }[] }>
    follow?: (request: { address?: { kind?: string, sessionId?: string } }, signal: AbortSignal) => AsyncIterable<unknown>
  } | undefined
  if (face === undefined || typeof face.list !== 'function' || typeof face.prompt !== 'function') return
  const originalList = face.list.bind(face)
  const originalPrompt = face.prompt.bind(face)
  const originalCancel = typeof face.cancel === 'function' ? face.cancel.bind(face) : undefined
  const originalProjections = typeof face.projections === 'function' ? face.projections.bind(face) : undefined
  const originalRename = typeof face.rename === 'function' ? face.rename.bind(face) : undefined
  const originalQueue = typeof face.updateQueue === 'function' ? face.updateQueue.bind(face) : undefined
  const originalModel = typeof face.selectModel === 'function' ? face.selectModel.bind(face) : undefined
  const originalFork = typeof face.fork === 'function' ? face.fork.bind(face) : undefined
  const originalAttachment = typeof face.attachment === 'function' ? face.attachment.bind(face) : undefined
  const originalSearch = typeof face.search === 'function' ? face.search.bind(face) : undefined
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
  if (originalSearch !== undefined) {
    face.search = async (request, signal) => {
      let local: { items?: { sessionId?: string, snippet?: string }[], hasMore?: boolean } = { items: [], hasMore: false }
      try {
        local = await originalSearch(request, signal)
      } catch {
        local = { items: [], hasMore: false }
      }
      return searchWithPeers(local, peers, request.query ?? '')
    }
  }
  if (originalAttachment !== undefined) {
    face.attachment = async (request, signal) => {
      const { sessionId, ...rest } = request
      const forwarded = await attachmentRemote(sessionId, rest)
      if (forwarded !== undefined) return forwarded
      return originalAttachment(request, signal)
    }
  }
  if (originalFork !== undefined) {
    face.fork = async (request, signal) => {
      const { sessionId, ...rest } = request
      const forwarded = await forkRemote(sessionId, rest)
      if (forwarded !== undefined) return forwarded
      return originalFork(request, signal)
    }
  }
  if (originalModel !== undefined) {
    face.selectModel = async (request, signal) => {
      const { sessionId, ...rest } = request
      const forwarded = await modelRemote(sessionId, rest)
      if (forwarded !== undefined) return forwarded
      return originalModel(request, signal)
    }
  }
  if (originalQueue !== undefined) {
    face.updateQueue = async (request, signal) => {
      const { sessionId, ...rest } = request
      const forwarded = await queueRemote(sessionId, rest)
      if (forwarded !== undefined) return forwarded
      return originalQueue(request, signal)
    }
  }
  if (originalRename !== undefined) {
    face.rename = async (request, signal) => {
      const forwarded = await renameRemote(request.sessionId, request.title)
      if (forwarded !== undefined) return forwarded
      return originalRename(request, signal)
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
    if (originalRename !== undefined) face.rename = originalRename
    if (originalQueue !== undefined) face.updateQueue = originalQueue
    if (originalModel !== undefined) face.selectModel = originalModel
    if (originalFork !== undefined) face.fork = originalFork
    if (originalAttachment !== undefined) face.attachment = originalAttachment
    if (originalSearch !== undefined) face.search = originalSearch
    if (originalFollow !== undefined) face.follow = originalFollow
    if (originalPage !== undefined) face.page = originalPage
    if (originalEvents !== undefined) face.events = originalEvents
  }, 'dsh-ahoy: attach')
}

function installApproval(ctx: HostContext, desk: ApprovalDesk): void {
  if (typeof ctx.on !== 'function') return
  try {
    const dispose = ctx.on('approval/request', function(request, next) {
      const sessionId = sessionIdFromApproval(request)
      if (sessionId === undefined) return next()
      return desk.decide(sessionId, {
        toolName: typeof request.toolName === 'string' ? request.toolName : '',
        ...typeof request.reason === 'string' ? { reason: request.reason } : {},
      }, next)
    })
    if (typeof dispose === 'function') ctx.effect(() => dispose, 'dsh-ahoy: approval')
  } catch (error) {
    console.error('[dsh-ahoy] 没有接上审批:', error)
  }
}

function registerApprovalRoute(ctx: HostContext): void {
  const webServer = optionalService<WebServer>(ctx, 'webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return
  const dispose = webServer.register({
    kind: 'exact',
    path: '/ahoy/approvals',
    handler(request, response) {
      void (async () => {
        if (request.method === 'GET') {
          const items = []
          for (const peer of peerList()) {
            try {
              for (const item of await approvalsPeer(peer)) items.push({ peer, ...item })
            } catch {
              // 对方没开审批接口时不挡住机器列表。
            }
          }
          const body = JSON.stringify({ items })
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(body),
          })
          response.end(body)
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { peer?: unknown, sessionId?: unknown, outcome?: unknown }
        if (typeof payload.peer !== 'string' || typeof payload.sessionId !== 'string' || !isApprovalOutcome(payload.outcome)) {
          response.writeHead(400)
          response.end('bad request')
          return
        }
        if (!peerList().includes(payload.peer)) {
          response.writeHead(403)
          response.end('peer is not paired')
          return
        }
        const result = await answerPeer(payload.peer, payload.sessionId, payload.outcome)
        const body = JSON.stringify(result)
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        })
        response.end(body)
      })().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(message)
      })
    },
  })
  ctx.effect(() => dispose, 'dsh-ahoy: approval-route')
}

function registerToolRoute(ctx: HostContext): void {
  const webServer = optionalService<WebServer>(ctx, 'webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return
  const dispose = webServer.register({
    kind: 'exact',
    path: '/ahoy/tool',
    handler(_request, response) {
      const tools = (typeof ctx.get === 'function' ? ctx.get('tools') : undefined) as ToolsFace | undefined
      let registered = false
      try {
        if (typeof tools?.get === 'function') registered = tools.get('ahoy') != null
      } catch {
        registered = false
      }
      const body = JSON.stringify({ name: 'ahoy', registered })
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      })
      response.end(body)
    },
  })
  ctx.effect(() => dispose, 'dsh-ahoy: tool-route')
}

export function apply(ctx: HostContext): void {
  const desk = new ApprovalDesk()
  registerTree(ctx)
  registerApprovalRoute(ctx)
  const bridge: SessionBridge = sessionsFromHost(ctx, desk)
  installApproval(ctx, desk)
  installOfficialAttach(ctx)
  const port = loadListenPort()
  let closePeer: (() => Promise<void>) | undefined
  let stopped = false
  if (port !== undefined) {
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
  registerToolRoute(ctx)

}
