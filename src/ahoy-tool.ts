import { promptPeer, readPeer } from './peer'

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

/**
 * 把一句话交给对方插件。返回值只有会话标识和一句摘要，不包含对方的工具日志。
 * 本机的会话桥不会被调用。
 */
export async function delegateToPeer(request: AhoyRequest): Promise<AhoyResult> {
  const status = await readPeer(request.peer)
  const sessionId = request.sessionId ?? status.sessions[0]?.sessionId
  if (sessionId === undefined) throw new Error('对方没有可委派的会话')
  const result = await promptPeer(request.peer, sessionId, request.text)
  return {
    sessionId: result.sessionId,
    accepted: true,
    summary: `已交给 ${request.peer} 的会话 ${result.sessionId}`,
  }
}

export const ahoyTool = {
  name: 'ahoy',
  description: '把一句话交给另一台已经配对的 DeepSeek Harness。执行发生在对方机器上。返回会话标识和一句摘要，不返回对方的工具日志。',
  parameters: {
    type: 'object',
    properties: {
      peer: { type: 'string', description: '对方插件的地址，例如 http://127.0.0.1:47321' },
      text: { type: 'string', description: '要交给对方的话' },
      sessionId: { type: 'string', description: '对方已有会话。省略时使用对方列表里的第一场会话。' },
    },
    required: ['peer', 'text'],
  },
  output: {
    schema: { type: 'string' },
    render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
  },
  async execute(args: { peer?: string, text?: string, sessionId?: string }): Promise<string> {
    if (typeof args.peer !== 'string' || typeof args.text !== 'string') {
      throw new Error('ahoy 需要 peer 和 text')
    }
    const result = await delegateToPeer({ peer: args.peer, text: args.text, sessionId: args.sessionId })
    return result.summary
  },
}
