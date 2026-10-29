import { promptPeer, readPeer, type RemoteSession } from './peer'
import { remoteSessionId } from './tree'

export interface ListedSession {
  sessionId: string
  title?: string
  agentAvailable?: boolean
  updatedAt?: number
  running?: boolean
  blank?: boolean
  projections?: {
    kind: 'cached'
    asOfSeq: number
    values: { title?: string }
  }
}

interface ListResult {
  items?: readonly ListedSession[]
}

interface PromptRequest {
  sessionId: string
  content?: readonly { type?: string, text?: string }[]
}

/** 把 ahoy: 前缀拆回对方地址和原始会话标识。 */
export function parseRemoteSessionId(sessionId: string): { peer: string, sessionId: string } | undefined {
  if (!sessionId.startsWith('ahoy:')) return undefined
  const rest = sessionId.slice('ahoy:'.length)
  const split = rest.indexOf(':')
  if (split <= 0) return undefined
  return {
    peer: decodeURIComponent(rest.slice(0, split)),
    sessionId: rest.slice(split + 1),
  }
}

export function remoteListItem(peer: string, session: RemoteSession): ListedSession {
  return {
    agentAvailable: true,
    sessionId: remoteSessionId(peer, session.sessionId),
    updatedAt: Date.now(),
    running: false,
    blank: false,
    projections: { kind: 'cached', asOfSeq: 0, values: { title: session.title } },
  }
}

/** 官方会话列表加上对方机器的会话。对方自己再列回来的 ahoy: 行不再套一层。 */
export async function listWithPeers<T extends ListResult>(
  local: T,
  peers: readonly string[],
): Promise<T> {
  const items = [...(local.items ?? [])]
  const seen = new Set(items.flatMap(item => typeof item.sessionId === 'string' ? [item.sessionId] : []))
  for (const peer of peers) {
    let remote: RemoteSession[] = []
    try {
      remote = (await readPeer(peer)).sessions
    } catch {
      continue
    }
    for (const session of remote) {
      if (session.sessionId.startsWith('ahoy:')) continue
      const sessionId = remoteSessionId(peer, session.sessionId)
      if (seen.has(sessionId)) continue
      seen.add(sessionId)
      items.push(remoteListItem(peer, session))
    }
  }
  return { ...local, items }
}

export async function promptRemote(request: PromptRequest): Promise<{ accepted: true } | undefined> {
  const remote = parseRemoteSessionId(request.sessionId)
  if (remote === undefined) return undefined
  const text = (request.content ?? [])
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
  await promptPeer(remote.peer, remote.sessionId, text)
  return { accepted: true }
}
