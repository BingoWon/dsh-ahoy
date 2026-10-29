/**
 * dsh-ahoy 宿主插件。
 *
 * 这一版只证明插件能被 profile 加载。机器列表、会话附着和委派都还没接上。
 * 不要在这里加转发进程，也不要通过 SSH 读取别的机器。
 */

interface HostContext {
  effect(dispose: () => void, label: string): void
}

export const name = 'dsh-ahoy'

export function apply(ctx: HostContext): void {
  ctx.effect(() => () => {}, 'dsh-ahoy: ready')
}
