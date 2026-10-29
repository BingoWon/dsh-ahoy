import assert from 'node:assert/strict'
import test from 'node:test'
import { delegateToPeer, promptPeer, readPeer, startPeer } from '../lib/index.js'

test('a prompt is executed by the peer, not by the caller', async () => {
  const localPrompts = []
  const remotePrompts = []
  const remote = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-on-b', title: '部署脚本' }]
    },
    async prompt(sessionId, text) {
      remotePrompts.push({ sessionId, text })
      return { accepted: true, sessionId }
    },
  })
  const local = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-on-a', title: '本机' }]
    },
    async prompt(sessionId, text) {
      localPrompts.push({ sessionId, text })
      return { accepted: true, sessionId }
    },
  })
  try {
    const status = await readPeer(`http://127.0.0.1:${remote.port}`)
    assert.equal(status.sessions[0]?.sessionId, 'session-on-b')
    assert.equal(typeof status.memoryTotalBytes, 'number')
    const result = await delegateToPeer({
      peer: `http://127.0.0.1:${remote.port}`,
      text: '看一下部署脚本',
    })
    assert.equal(result.sessionId, 'session-on-b')
    assert.equal(result.summary.includes('session-on-b'), true)
    assert.deepEqual(remotePrompts, [{ sessionId: 'session-on-b', text: '看一下部署脚本' }])
    assert.deepEqual(localPrompts, [])
    const rejected = await fetch(`http://127.0.0.1:${local.port}/v1/status`)
    assert.equal(rejected.status, 405)
    await assert.rejects(promptPeer(`http://127.0.0.1:${remote.port}`, 'session-on-b', '   '))
  } finally {
    await remote.close()
    await local.close()
  }
})
