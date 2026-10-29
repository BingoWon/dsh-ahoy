/** 对方会话在官方会话树里使用的标识。前缀避免和本机会话撞车。 */
export function remoteSessionId(peer: string, sessionId: string): string {
  return `ahoy:${encodeURIComponent(peer)}:${sessionId}`
}

/** 官方会话树用路径的最后一段当分组标题。 */
/** 官方新建会话如果带了这台机器的分组路径，就改由对方创建。 */
export function peerForGroup(cwd: string | undefined, peers: readonly string[]): string | undefined {
  if (cwd === undefined || !cwd.startsWith('ahoy/')) return undefined
  const host = cwd.slice('ahoy/'.length)
  return peers.find(peer => {
    try {
      return new URL(peer).host === host
    } catch {
      return false
    }
  })
}

export function machineGroupPath(peer: string): string {
  try {
    const host = new URL(peer).host
    return `ahoy/${host !== '' ? host : peer}`
  } catch {
    return `ahoy/${peer}`
  }
}

export interface TreeSession {
  peer: string
  sessionId: string
  title: string
}

export interface MachineCard {
  peer: string
  cpuPercent: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  diskUsedBytes: number | null
  diskTotalBytes: number | null
  sessions: { sessionId: string, title: string }[]
  error?: string
}

/** 把字节数收成卡片上的短数字。空值保持破折号，不假装读到了 0。 */
export function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  const digits = unit === 0 || size >= 10 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unit]}`
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
