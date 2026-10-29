import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 环境变量优先。桌面应用没有这个环境变量时，读 profile 目录里的 ahoy-peers.json。 */
export function peerUrls(envValue: string | undefined, fileText: string | undefined): string[] {
  const fromEnv = (envValue ?? '').split(',').map(item => item.trim()).filter(item => item !== '')
  if (fromEnv.length > 0) return fromEnv
  if (fileText === undefined || fileText.trim() === '') return []
  try {
    const parsed = JSON.parse(fileText) as { peers?: unknown }
    if (!Array.isArray(parsed.peers)) return []
    return parsed.peers.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim()] : [])
  } catch {
    return []
  }
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
  return peerUrls(env.DSH_AHOY_PEERS, fileText)
}
