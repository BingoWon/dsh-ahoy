/**
 * 客户端：设置里的 Ahoy 页，以及侧边栏里的空机器列表。
 * 桌面应用加载的是同一套客户端。
 */
import { createElement as h, type ReactNode } from 'react'

const NS = 'dsh-ahoy'

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
type Key = keyof Dict

function dictionary(): Dict {
  const language = typeof navigator === 'undefined' ? 'zh' : navigator.language.toLowerCase()
  return language.startsWith('zh') ? zh : en
}

function MachineList(): ReactNode {
  const text = dictionary()
  return h('section', { style: { padding: '16px', lineHeight: 1.5 } },
    h('h2', { style: { margin: '0 0 8px', fontSize: '16px' } }, text.title),
    h('p', { style: { margin: 0 } }, text.empty),
  )
}

interface SlotOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: () => string
  locale?: string
}

interface ClientContext {
  effect(dispose: () => void, label: string): void
  locale: {
    register(namespace: string, dictionaries: { zh: Dict, en: Dict }): () => void
    bind(namespace: string): (key: Key) => string
  }
  slots: {
    inject(name: string, register: () => () => void): () => void
    register(options: SlotOptions, component: () => ReactNode): () => void
  }
}

function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ahoy: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'dsh-ahoy',
    order: 40,
    label: () => t('settings.tab'),
    locale: NS,
  }, MachineList))
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
  }, MachineList))
}

module.exports = {
  name: 'dsh-ahoy',
  inject: ['slots', 'locale'],
  apply,
}
