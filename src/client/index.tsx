/**
 * 客户端：设置页、侧边栏，以及把对方会话宣布进官方会话树。
 * 桌面应用加载的是同一套客户端。
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { framesForNewSessions, type TreeSession } from '../tree'

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

function useRemoteSessions(sessions: OfficialSessions | undefined): TreeSession[] {
  const [rows, setRows] = useState<TreeSession[]>([])
  useEffect(() => {
    let stopped = false
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch('/ahoy/tree')
        if (!response.ok) return
        const body = await response.json() as { sessions?: TreeSession[] }
        const next = Array.isArray(body.sessions) ? body.sessions : []
        if (!stopped) setRows(next)
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
  return rows
}

function MachineList({ sessions }: { sessions?: OfficialSessions }): ReactNode {
  const text = dictionary()
  const rows = useRemoteSessions(sessions)
  return h('section', { style: { padding: '16px', lineHeight: 1.5 } },
    h('h2', { style: { margin: '0 0 8px', fontSize: '16px' } }, text.title),
    rows.length === 0
      ? h('p', { style: { margin: 0 } }, text.empty)
      : h('ul', { style: { margin: 0, paddingLeft: '18px' } }, rows.map(row => h('li', {
        key: `${row.peer}:${row.sessionId}`,
      }, `${row.title} · ${row.peer}`))),
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
  locale: {
    register(namespace: string, dictionaries: { zh: Dict, en: Dict }): () => void
    bind(namespace: string): (key: keyof Dict) => string
  }
  slots: {
    inject(name: string, register: () => () => void): () => void
    register(options: SlotOptions, component: (props: { sessions?: OfficialSessions }) => ReactNode): () => void
  }
}

function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ahoy: dictionaries')
  const t = ctx.locale.bind(NS)
  const page = (props: { sessions?: OfficialSessions }): ReactNode => h(MachineList, props)
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
  inject: ['slots', 'locale', 'sessions'],
  apply,
}
