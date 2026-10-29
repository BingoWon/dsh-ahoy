import { createPeer, promptPeer, readPeer } from './peer'

export interface AhoyRequest {
  peer: string
  text: string
  sessionId?: string
}

export interface AhoyResult {
  sessionId: string
  accepted: true
  summary: string
}

/** 只把话交给已经配对的机器。只有一台时可以不写地址。 */
export function resolvePeer(requested: string | undefined, configured: readonly string[]): string {
  if (configured.length === 0) throw new Error('还没有配对的机器')
  const name = requested?.trim() ?? ''
  if (name === '') {
    if (configured.length === 1) return configured[0] ?? ''
    throw new Error('有多台机器，需要指定 peer')
  }
  const found = configured.find(peer => peer === name)
  if (found === undefined) throw new Error('这台机器没有配对')
  return found
}

/**
 * 把一句话交给对方插件。返回值只有会话标识和一句摘要，不包含对方的工具日志。
 * 本机的会话桥不会被调用。
 */
export async function delegateToPeer(request: AhoyRequest): Promise<AhoyResult> {
  const status = await readPeer(request.peer)
  let sessionId = request.sessionId ?? status.sessions[0]?.sessionId
  if (sessionId === undefined) sessionId = (await createPeer(request.peer, {})).sessionId
  const result = await promptPeer(request.peer, sessionId, request.text)
  return {
    sessionId: result.sessionId,
    accepted: true,
    summary: `已交给 ${request.peer} 的会话 ${result.sessionId}`,
  }
}

export function createAhoyTool(configuredPeers: () => readonly string[]) {
  return {
    name: 'ahoy',
    description: '把一句话交给另一台已经配对的 DeepSeek Harness。执行发生在对方机器上。返回会话标识和一句摘要，不返回对方的工具日志。只有一台配对机器时可以不填 peer。',
    parameters: {
      type: 'object',
      properties: {
        peer: { type: 'string', description: '已配对机器的地址。只有一台时可以省略。' },
        text: { type: 'string', description: '要交给对方的话' },
        sessionId: { type: 'string', description: '对方已有会话。省略时使用对方列表里的第一场会话。' },
      },
      required: ['text'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args: { peer?: string, text?: string, sessionId?: string }): Promise<string> {
      if (typeof args.text !== 'string') throw new Error('ahoy 需要 text')
      const result = await delegateToPeer({
        peer: resolvePeer(args.peer, configuredPeers()),
        text: args.text,
        sessionId: args.sessionId,
      })
      return result.summary
    },
  }
}

export const ahoyTool = createAhoyTool(() => [])
