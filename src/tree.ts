/** 对方会话在官方会话树里使用的标识。前缀避免和本机会话撞车。 */
export function remoteSessionId(peer: string, sessionId: string): string {
  return `ahoy:${encodeURIComponent(peer)}:${sessionId}`
}

export interface TreeSession {
  peer: string
  sessionId: string
  title: string
}

export interface TreeFrame {
  type: 'host/session-added' | 'session/projection'
  sessionId: string
  blank?: false
  key?: 'title'
  value?: string
  seq?: number
}

/** 只为还没宣布过的对方会话产生官方树帧。 */
export function framesForNewSessions(seen: Set<string>, sessions: readonly TreeSession[]): TreeFrame[] {
  const frames: TreeFrame[] = []
  for (const session of sessions) {
    const sessionId = remoteSessionId(session.peer, session.sessionId)
    if (seen.has(sessionId)) continue
    seen.add(sessionId)
    frames.push({ type: 'host/session-added', sessionId, blank: false })
    frames.push({
      type: 'session/projection',
      sessionId,
      key: 'title',
      value: session.title,
      seq: 0,
    })
  }
  return frames
}
