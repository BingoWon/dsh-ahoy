/**
 * 客户端：设置页、侧边栏，以及把对方会话宣布进官方会话树。
 * 桌面应用加载的是同一套客户端。
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { formatBytes, framesForNewSessions, remoteSessionId, usableModels, type MachineCard, type TreeSession } from '../tree'

const NS = 'dsh-ahoy'
const announced = new Set<string>()

const zh = {
  'settings.tab': 'Ahoy',
  'sidebar.label': 'Ahoy',
  title: '机器',
  empty: '还没有配对的机器。',
}

const en = {
  'settings.tab': 'Ahoy',
  'sidebar.label': 'Ahoy',
  title: 'Machines',
  empty: 'No paired machines.',
}

type Dict = typeof zh

function dictionary(): Dict {
  const language = typeof navigator === 'undefined' ? 'zh' : navigator.language.toLowerCase()
  return language.startsWith('zh') ? zh : en
}

interface HostEnvelope {
  type: 'server-request'
  rpcId: string
  method: 'events.host'
  payload: unknown
}

interface OfficialSessions {
  handleHostEnvelope?(envelope: HostEnvelope): void
}

function useRemoteSessions(sessions: OfficialSessions | undefined): { machines: MachineCard[], rows: TreeSession[] } {
  const [machines, setMachines] = useState<MachineCard[]>([])
  const [rows, setRows] = useState<TreeSession[]>([])
  useEffect(() => {
    let stopped = false
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch('/ahoy/tree')
        if (!response.ok) return
        const body = await response.json() as { machines?: MachineCard[], sessions?: TreeSession[] }
        const next = Array.isArray(body.sessions) ? body.sessions : []
        if (!stopped) {
          setRows(next)
          setMachines(Array.isArray(body.machines) ? body.machines : [])
        }
        for (const frame of framesForNewSessions(announced, next)) {
          sessions?.handleHostEnvelope?.({
            type: 'server-request',
            rpcId: 'ahoy',
            method: 'events.host',
            payload: frame,
          })
        }
      } catch {
        // 路由还没挂上时保持空列表。
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [sessions])
  return { machines, rows }
}

function machineLine(machine: MachineCard): string {
  if (machine.error !== undefined) return machine.error
  const cpu = machine.cpuPercent === null ? '—' : `${Math.round(machine.cpuPercent)}%`
  return `CPU ${cpu} · 内存 ${formatBytes(machine.memoryUsedBytes)} / ${formatBytes(machine.memoryTotalBytes)} · 磁盘 ${formatBytes(machine.diskUsedBytes)} / ${formatBytes(machine.diskTotalBytes)}`
}

interface RemoteApproval {
  peer: string
  sessionId: string
  toolName: string
  reason?: string
}

function useApprovals(): RemoteApproval[] {
  const [items, setItems] = useState<RemoteApproval[]>([])
  useEffect(() => {
    let stopped = false
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch('/ahoy/approvals')
        if (!response.ok) return
        const body = await response.json() as { items?: RemoteApproval[] }
        if (!stopped) setItems(Array.isArray(body.items) ? body.items : [])
      } catch {
        // 路由还没挂上时不显示审批。
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])
  return items
}

function decide(item: RemoteApproval, outcome: 'allowed-once' | 'rejected'): void {
  void fetch('/ahoy/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peer: item.peer, sessionId: item.sessionId, outcome }),
  })
}

const NO_MODEL = '这台机器还没有可用模型'

function peerOfRemoteSession(sessionId: string): string | undefined {
  if (!sessionId.startsWith('ahoy:')) return undefined
  const rest = sessionId.slice('ahoy:'.length)
  const split = rest.indexOf(':')
  if (split < 0) return undefined
  try {
    return decodeURIComponent(rest.slice(0, split))
  } catch {
    return undefined
  }
}

function useMachineModels(peer: string): string {
  const [text, setText] = useState('正在读取这台机器的模型')
  useEffect(() => {
    let stopped = false
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch('/ahoy/model-catalog', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ peer }),
        })
        if (!response.ok) {
          if (!stopped) setText(NO_MODEL)
          return
        }
        const names = usableModels(await response.json()).map(model => model.name)
        if (!stopped) setText(names.length === 0 ? NO_MODEL : `可用模型 ${names.join('、')}`)
      } catch {
        if (!stopped) setText(NO_MODEL)
      }
    }
    void tick()
    return () => { stopped = true }
  }, [peer])
  return text
}

function MachineModels({ peer }: { peer: string }): ReactNode {
  return h('p', { style: { margin: '4px 0' } }, useMachineModels(peer))
}

function MachineList({ sessions, openSession }: { sessions?: OfficialSessions, openSession: (sessionId: string) => void }): ReactNode {
  const text = dictionary()
  const { machines } = useRemoteSessions(sessions)
  const approvals = useApprovals()
  return h('section', { style: { padding: '16px', lineHeight: 1.5 } },
    h('h2', { style: { margin: '0 0 8px', fontSize: '16px' } }, text.title),
    approvals.map(item => h('article', {
      key: `${item.peer}:${item.sessionId}`,
      style: { marginBottom: '12px' },
    },
    h('p', { style: { margin: '0 0 8px' } }, `${item.toolName || '审批'} · ${item.reason ?? item.sessionId}`),
    h('button', { type: 'button', onClick: () => decide(item, 'allowed-once') }, '允许一次'),
    h('button', { type: 'button', onClick: () => decide(item, 'rejected'), style: { marginLeft: '8px' } }, '拒绝'),
    )),
    machines.length === 0
      ? h('p', { style: { margin: 0 } }, text.empty)
      : machines.map(machine => h('article', {
        key: machine.peer,
        style: { marginBottom: '12px' },
      },
      h('strong', null, machine.peer),
      h('p', { style: { margin: '4px 0' } }, machineLine(machine)),
      h(MachineModels, { peer: machine.peer }),
      machine.sessions.length === 0 ? null : h('ul', { style: { margin: 0, paddingLeft: '18px' } },
        machine.sessions.map(session => h('li', { key: session.sessionId },
          h('button', {
            type: 'button',
            onClick: () => openSession(remoteSessionId(machine.peer, session.sessionId)),
            style: { background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', textDecoration: 'underline' },
          }, session.title),
        )),
      ),
      )),
  )
}

interface SlotOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: () => string
  locale?: string
  inject?: () => { sessions?: OfficialSessions }
}

interface ClientContext {
  effect(dispose: () => void, label: string): void
  sessions?: OfficialSessions
  uiWorkspace?: { openSession?: (target: string) => void }
  remote?: { session?: { modelCatalog?: () => Promise<unknown> } }
  models?: {
    directoryFor?: (sessionId: string) => { load?: () => Promise<unknown>, __ahoyWrapped?: boolean }
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Dict, en: Dict }): () => void
    bind(namespace: string): (key: keyof Dict) => string
  }
  slots: {
    inject(name: string, register: () => () => void): () => void
    register(options: SlotOptions, component: (props: { sessions?: OfficialSessions }) => ReactNode): () => void
  }
}

function installRemoteModelCatalog(ctx: ClientContext): void {
  const remoteSession = ctx.remote?.session
  const models = ctx.models
  if (remoteSession === undefined || typeof remoteSession.modelCatalog !== 'function' || models === undefined || typeof models.directoryFor !== 'function') return
  let catalogSession: string | undefined
  const originalCatalog = remoteSession.modelCatalog.bind(remoteSession)
  remoteSession.modelCatalog = () => {
    if (catalogSession === undefined) return originalCatalog()
    const sessionId = catalogSession
    return (async () => {
      const peer = peerOfRemoteSession(sessionId)
      if (peer === undefined) return { ok: false, error: { code: 'ahoy', message: NO_MODEL } }
      const response = await fetch('/ahoy/model-catalog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ peer }),
      })
      if (!response.ok) return { ok: false, error: { code: 'ahoy', message: NO_MODEL } }
      const value: unknown = await response.json()
      if (usableModels(value).length === 0) return { ok: false, error: { code: 'ahoy', message: NO_MODEL } }
      return { ok: true, value }
    })()
  }
  const originalDirectory = models.directoryFor.bind(models)
  models.directoryFor = (sessionId) => {
    const directory = originalDirectory(sessionId)
    if (!sessionId.startsWith('ahoy:') || directory.__ahoyWrapped === true || typeof directory.load !== 'function') return directory
    const load = directory.load.bind(directory)
    directory.load = () => {
      catalogSession = sessionId
      try {
        return load()
      } finally {
        catalogSession = undefined
      }
    }
    directory.__ahoyWrapped = true
    return directory
  }
}

function apply(ctx: ClientContext): void {
  installRemoteModelCatalog(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ahoy: dictionaries')
  const t = ctx.locale.bind(NS)
  const page = (props: { sessions?: OfficialSessions }): ReactNode => h(MachineList, {
    ...props,
    openSession: (sessionId) => ctx.uiWorkspace?.openSession?.(sessionId),
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'dsh-ahoy',
    order: 40,
    label: () => t('settings.tab'),
    locale: NS,
    inject: () => ({ sessions: ctx.sessions }),
  }, page))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'dsh-ahoy',
    order: 40,
    label: () => t('sidebar.label'),
    locale: NS,
  }, () => null))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'dsh-ahoy',
    locale: NS,
    inject: () => ({ sessions: ctx.sessions }),
  }, page))
}

module.exports = {
  name: 'dsh-ahoy',
  inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
  apply,
}
