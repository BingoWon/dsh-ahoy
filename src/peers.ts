import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PeerRef {
  url: string
  token?: string
}

const peerTokens = new Map<string, string>()

/** 记下配对文件里的令牌。撤销就是换成另一枚，旧请求会被拒绝。 */
export function setPeerToken(url: string, token: string | undefined): void {
  if (token === undefined || token === '') peerTokens.delete(url)
  else peerTokens.set(url, token)
}

export function peerAuthHeader(url: string): Record<string, string> {
  const token = peerTokens.get(url)
  return token === undefined ? {} : { 'x-ahoy-token': token }
}

/** 环境变量优先。桌面应用没有这个环境变量时，读 profile 目录里的 ahoy-peers.json。 */
export function peerRefs(envValue: string | undefined, fileText: string | undefined): PeerRef[] {
  const fromEnv = (envValue ?? '').split(',').map(item => item.trim()).filter(item => item !== '')
  if (fromEnv.length > 0) return fromEnv.map(url => ({ url }))
  if (fileText === undefined || fileText.trim() === '') return []
  try {
    const parsed = JSON.parse(fileText) as { peers?: unknown }
    if (!Array.isArray(parsed.peers)) return []
    return parsed.peers.flatMap(item => {
      if (typeof item === 'string' && item.trim() !== '') return [{ url: item.trim() }]
      if (item !== null && typeof item === 'object' && 'url' in item && typeof item.url === 'string' && item.url.trim() !== '') {
        const token = 'token' in item && typeof item.token === 'string' ? item.token : undefined
        return [{ url: item.url.trim(), token }]
      }
      return []
    })
  } catch {
    return []
  }
}

export function peerUrls(envValue: string | undefined, fileText: string | undefined): string[] {
  return peerRefs(envValue, fileText).map(peer => peer.url)
}

export function peerConfigPath(profileDir: string | undefined): string | undefined {
  if (profileDir === undefined || profileDir === '') return undefined
  return join(profileDir, 'ahoy-peers.json')
}

/** DSH 用 `file://<profile>/#dsh-ahoy` 调用插件。环境变量还没写上时，从这层调用栈认出 profile。 */
export function profileDirFromStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined
  const match = stack.match(/file:\/\/(\/[^)\s]+)\/#dsh-ahoy\b/)
  const found = match?.[1]
  if (found === undefined) return undefined
  try {
    return decodeURIComponent(found)
  } catch {
    return undefined
  }
}

export function profileDirFromArgv(argv: readonly string[], home: string | undefined): string | undefined {
  if (home === undefined || home === '') return undefined
  const index = argv.indexOf('--profile')
  const name = index >= 0 ? argv[index + 1] : undefined
  if (name === undefined || name === '' || name.startsWith('-')) return undefined
  return join(home, 'profiles', name)
}

export function loadPeerUrls(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  stack: string | undefined = new Error().stack,
): string[] {
  const path = peerConfigPath(env.DSH_PROFILE_DIR || profileDirFromArgv(argv, env.DSH_HOME) || profileDirFromStack(stack))
  let fileText: string | undefined
  if (path !== undefined) {
    try {
      fileText = readFileSync(path, 'utf8')
    } catch {
      fileText = undefined
    }
  }
  const refs = peerRefs(env.DSH_AHOY_PEERS, fileText)
  for (const peer of refs) setPeerToken(peer.url, peer.token)
  return refs.map(peer => peer.url)
}
