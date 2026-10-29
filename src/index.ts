/**
 * dsh-ahoy 宿主插件。
 *
 * 两个 profile 用 127.0.0.1 直接互连。DSH_AHOY_LISTEN 是本机监听端口。
 * 不要加转发进程，也不要走 SSH。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ahoyTool } from './ahoy-tool'
import { readPeer, sessionsFromHost, startPeer, type SessionBridge } from './peer'

export { delegateToPeer } from './ahoy-tool'
export { promptPeer, readPeer, sessionsFromHost, startPeer } from './peer'

interface ToolsFace {
  register(tool: typeof ahoyTool): () => void
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
  return (process.env.DSH_AHOY_PEERS ?? '').split(',').map(item => item.trim()).filter(item => item !== '')
}

function registerTree(ctx: HostContext): void {
  const webServer = optionalService<WebServer>(ctx, 'webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return
  const dispose = webServer.register({
    kind: 'exact',
    path: '/ahoy/tree',
    handler(_request, response) {
      void (async () => {
        const sessions: { peer: string, sessionId: string, title: string }[] = []
        for (const peer of peerList()) {
          try {
            const status = await readPeer(peer)
            for (const session of status.sessions) {
              sessions.push({ peer, sessionId: session.sessionId, title: session.title })
            }
          } catch (error) {
            sessions.push({
              peer,
              sessionId: '',
              title: error instanceof Error ? error.message : String(error),
            })
          }
        }
        const body = JSON.stringify({ sessions })
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

export function apply(ctx: HostContext): void {
  registerTree(ctx)
  const listen = process.env.DSH_AHOY_LISTEN
  let closePeer: (() => Promise<void>) | undefined
  let stopped = false
  if (listen !== undefined && listen !== '') {
    const port = Number(listen)
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`DSH_AHOY_LISTEN 不是端口: ${listen}`)
    }
    const sessions: SessionBridge = sessionsFromHost(ctx)
    void startPeer(port, sessions).then(handle => {
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
    const dispose = face.register(ahoyTool)
    ctx.effect(() => dispose, 'dsh-ahoy: tool')
  }

}
