/**
 * dsh-ahoy 宿主插件。
 *
 * 两个 profile 用 127.0.0.1 直接互连。DSH_AHOY_LISTEN 是本机监听端口。
 * 不要加转发进程，也不要走 SSH。
 */
import { ahoyTool } from './ahoy-tool'
import { sessionsFromHost, startPeer, type SessionBridge } from './peer'

export { delegateToPeer } from './ahoy-tool'
export { promptPeer, readPeer, sessionsFromHost, startPeer } from './peer'

interface ToolsFace {
  register(tool: typeof ahoyTool): () => void
}

interface HostContext {
  effect(dispose: () => void, label: string): void
  get?(name: string): unknown
  tools?: ToolsFace
  sessionController?: Parameters<typeof sessionsFromHost>[0]['sessionController']
}

export const name = 'dsh-ahoy'

export function apply(ctx: HostContext): void {
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
