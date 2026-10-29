import { randomBytes } from 'node:crypto'

export interface PairClaims {
  url: string
  secret: string
  expiresAt: number
}

interface Ticket {
  redeemUntil: number
  paired: boolean
}

/** 配对码里带着对方地址。没有中继，短数字码找不到机器。 */
export function issuePairCode(url: string, now = Date.now(), ttlMs = 600_000): { code: string, secret: string, expiresAt: number } {
  const secret = randomBytes(16).toString('base64url')
  const expiresAt = now + ttlMs
  const code = `ahoy1.${Buffer.from(JSON.stringify({ url, secret, expiresAt }), 'utf8').toString('base64url')}`
  return { code, secret, expiresAt }
}

export async function redeemPairCode(code: string): Promise<{ url: string, token: string }> {
  const claims = readPairCode(code)
  const response = await fetch(new URL('/v1/pair', claims.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: claims.secret }),
  })
  if (!response.ok) throw new Error('这个码不能再用')
  const body = await response.json() as { token?: unknown }
  if (typeof body.token !== 'string') throw new Error('这个码不能再用')
  return { url: claims.url, token: body.token }
}

export function readPairCode(code: string, now = Date.now()): PairClaims {
  if (!code.startsWith('ahoy1.')) throw new Error('这个码不能再用')
  let parsed: Partial<PairClaims>
  try {
    parsed = JSON.parse(Buffer.from(code.slice('ahoy1.'.length), 'base64url').toString('utf8')) as Partial<PairClaims>
  } catch {
    throw new Error('这个码不能再用')
  }
  if (typeof parsed.url !== 'string' || typeof parsed.secret !== 'string' || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= now) {
    throw new Error('这个码不能再用')
  }
  return { url: parsed.url, secret: parsed.secret, expiresAt: parsed.expiresAt }
}

/** 码只能兑换一次。兑换后的令牌一直有效，直到撤销。 */
export class PairDesk {
  private readonly tickets = new Map<string, Ticket>()

  issue(url: string, now = Date.now()): { code: string, expiresAt: number } {
    const issued = issuePairCode(url, now)
    this.tickets.set(issued.secret, { redeemUntil: issued.expiresAt, paired: false })
    return { code: issued.code, expiresAt: issued.expiresAt }
  }

  redeem(secret: string, now = Date.now()): { token: string } {
    const ticket = this.tickets.get(secret)
    if (ticket === undefined || ticket.paired || ticket.redeemUntil <= now) throw new Error('这个码不能再用')
    ticket.paired = true
    return { token: secret }
  }

  accepts(secret: string): boolean {
    return this.tickets.get(secret)?.paired === true
  }

  hasRedeemed(): boolean {
    for (const ticket of this.tickets.values()) {
      if (ticket.paired) return true
    }
    return false
  }

  revoke(secret: string): void {
    this.tickets.delete(secret)
  }
}
