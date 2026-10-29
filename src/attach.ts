import { callPeer, cancelPeer, createPeer, followPeer, pagePeer, promptPeer, readPeer, searchPeer, type RemoteSession } from './peer'
import { machineGroupPath, remoteSessionId } from './tree'

export interface ListedSession {
  sessionId: string
  title?: string
  agentAvailable?: boolean
  updatedAt?: number
  running?: boolean
  blank?: boolean
  formatStatus?: 'current'
  cwd?: string
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
    formatStatus: 'current',
    cwd: machineGroupPath(peer),
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

/** 用对方的原始会话读历史，再把记录里的标识换回官方树上的 ahoy: 标识。 */
export async function cancelRemote(sessionId: string): Promise<{ accepted: true } | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  return await cancelPeer(remote.peer, remote.sessionId)
}

export async function* followRemote(sessionId: string, request: Record<string, unknown>, signal: AbortSignal): AsyncGenerator<unknown> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return
  for await (const frame of followPeer(remote.peer, remote.sessionId, request, signal)) {
    const encoded = JSON.stringify(frame).split(remote.sessionId).join(sessionId)
    yield JSON.parse(encoded) as unknown
  }
}

export async function createOnPeer(peer: string, request: Record<string, unknown> = {}): Promise<{ sessionId: string, agentPreset?: string }> {
  const created = await createPeer(peer, request)
  return { ...created, sessionId: remoteSessionId(peer, created.sessionId) }
}

export async function attachmentRemote(sessionId: string, request: Record<string, unknown>): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const value = await callPeer(remote.peer, 'attachment', remote.sessionId, request)
  const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId)
  return JSON.parse(encoded) as unknown
}

export async function forkRemote(sessionId: string, request: Record<string, unknown>): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const value = await callPeer(remote.peer, 'fork', remote.sessionId, request) as { sessionId?: string }
  if (typeof value.sessionId !== 'string') return value
  return { ...value, sessionId: remoteSessionId(remote.peer, value.sessionId) }
}

export async function searchWithPeers<T extends { items?: readonly { sessionId?: string, snippet?: string }[] }>(
  local: T,
  peers: readonly string[],
  query: string,
): Promise<T> {
  const items = [...(local.items ?? [])]
  const seen = new Set(items.flatMap(item => typeof item.sessionId === 'string' ? [item.sessionId] : []))
  for (const peer of peers) {
    let hits: { sessionId: string, snippet: string }[] = []
    try {
      hits = await searchPeer(peer, query)
    } catch {
      continue
    }
    for (const hit of hits) {
      if (hit.sessionId.startsWith('ahoy:')) continue
      const sessionId = remoteSessionId(peer, hit.sessionId)
      if (seen.has(sessionId)) continue
      seen.add(sessionId)
      items.push({ sessionId, snippet: hit.snippet })
    }
  }
  return { ...local, items }
}

export async function modelRemote(sessionId: string, request: Record<string, unknown>): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const value = await callPeer(remote.peer, 'selectModel', remote.sessionId, request)
  const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId)
  return JSON.parse(encoded) as unknown
}

export async function queueRemote(sessionId: string, request: Record<string, unknown>): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const value = await callPeer(remote.peer, 'updateQueue', remote.sessionId, request)
  const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId)
  return JSON.parse(encoded) as unknown
}

export async function renameRemote(sessionId: string, title: string): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const value = await callPeer(remote.peer, 'rename', remote.sessionId, { title })
  const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId)
  return JSON.parse(encoded) as unknown
}

export async function projectionRemote(sessionId: string): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const value = await callPeer(remote.peer, 'projections', remote.sessionId, {})
  const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId)
  return JSON.parse(encoded) as unknown
}

export async function pageRemote(sessionId: string, request: Record<string, unknown>): Promise<unknown | undefined> {
  const remote = parseRemoteSessionId(sessionId)
  if (remote === undefined) return undefined
  const page = await pagePeer(remote.peer, remote.sessionId, request)
  const encoded = JSON.stringify(page).split(remote.sessionId).join(sessionId)
  return JSON.parse(encoded) as unknown
}
