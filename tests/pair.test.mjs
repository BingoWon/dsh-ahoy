import assert from 'node:assert/strict'
import test from 'node:test'
import { readMachineStatus, readPairCode, redeemPairCode, setPeerToken, startPeer } from '../lib/index.js'
import { cardAfterFetch } from '../lib/tree.js'
import { upsertPeer } from '../lib/peers.js'

test('a pairing code works once and revoke cuts the old token off', async () => {
  const peer = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-b', title: '部署脚本' }]
    },
    async prompt(sessionId) {
      return { accepted: true, sessionId }
    },
  })
  const url = `http://127.0.0.1:${peer.port}`
  try {
    const issued = peer.desk.issue(url, Date.now())
    const claims = readPairCode(issued.code)
    const paired = await redeemPairCode(issued.code)
    assert.equal(paired.url, url)
    assert.equal(paired.token, claims.secret)
    await assert.rejects(redeemPairCode(issued.code), /这个码不能再用/)
    setPeerToken(url, paired.token)
    const status = await fetch(new URL('/v1/status', url), {
      method: 'POST',
      headers: { 'x-ahoy-token': paired.token },
    })
    assert.equal(status.status, 200)
    peer.desk.revoke(paired.token)
    const revoked = await fetch(new URL('/v1/status', url), {
      method: 'POST',
      headers: { 'x-ahoy-token': paired.token },
    })
    assert.equal(revoked.status, 403)
  } finally {
    setPeerToken(url, undefined)
    await peer.close()
  }
})

test('the second cpu sample is a percentage', async () => {
  readMachineStatus()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(typeof readMachineStatus().cpuPercent, 'number')
})

test('an offline machine keeps the last session list and says it is cached', () => {
  const cache = new Map()
  const live = {
    peer: 'http://127.0.0.1:1',
    cpuPercent: 3,
    memoryUsedBytes: 1,
    memoryTotalBytes: 2,
    diskUsedBytes: 1,
    diskTotalBytes: 2,
    sessions: [{ sessionId: 'session-b', title: '部署脚本' }],
  }
  cardAfterFetch(cache, live.peer, live, 1)
  const offline = cardAfterFetch(cache, live.peer, { ...live, sessions: [], error: 'down' }, 2)
  assert.equal(offline.error, '这是缓存，不是现在')
  assert.equal(offline.sessions[0].title, '部署脚本')
  assert.equal(upsertPeer(undefined, { url: 'http://127.0.0.1:1', token: 'abc' }).includes('"token": "abc"'), true)
})
