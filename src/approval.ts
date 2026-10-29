export type ApprovalOutcome = 'allowed-once' | 'rejected'

export interface PendingApproval {
  sessionId: string
  toolName: string
  reason?: string
}

interface Waiting extends PendingApproval {
  answer: (outcome: ApprovalOutcome) => void
}

/** 从审批请求里取出对方会话标识。没有标识就交给原来的审批链。 */
export function sessionIdFromApproval(request: {
  agent?: { session?: { id?: unknown, header?: { id?: unknown } } }
}): string | undefined {
  const session = request.agent?.session
  if (typeof session?.id === 'string' && session.id !== '') return session.id
  if (typeof session?.header?.id === 'string' && session.header.id !== '') return session.header.id
  return undefined
}

export function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
  return value === 'allowed-once' || value === 'rejected'
}

/** 对方机器上等待这一侧点允许或拒绝。超时就交回原来的审批链。 */
export class ApprovalDesk {
  private readonly waiting = new Map<string, Waiting>()

  list(): PendingApproval[] {
    return [...this.waiting.values()].map(item => ({
      sessionId: item.sessionId,
      toolName: item.toolName,
      ...item.reason !== undefined ? { reason: item.reason } : {},
    }))
  }

  answer(sessionId: string, outcome: ApprovalOutcome): boolean {
    const pending = this.waiting.get(sessionId)
    if (pending === undefined) return false
    this.waiting.delete(sessionId)
    pending.answer(outcome)
    return true
  }

  decide(
    sessionId: string,
    info: { toolName: string, reason?: string },
    next: () => unknown,
    timeoutMs = 120_000,
  ): Promise<unknown> {
    if (this.waiting.has(sessionId)) return Promise.resolve(next())
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.waiting.delete(sessionId)
        resolve(next())
      }, timeoutMs)
      this.waiting.set(sessionId, {
        sessionId,
        toolName: info.toolName,
        ...info.reason !== undefined ? { reason: info.reason } : {},
        answer: outcome => {
          clearTimeout(timer)
          this.waiting.delete(sessionId)
          resolve(outcome)
        },
      })
    })
  }
}
