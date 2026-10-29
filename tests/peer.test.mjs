import assert from 'node:assert/strict'
import test from 'node:test'
import { createAhoyTool, delegateToPeer, promptPeer, readPeer, resolvePeer, setPeerToken, startPeer } from '../lib/index.js'

test('the ahoy tool uses the only paired machine and refuses an unknown one', async () => {
  assert.equal(resolvePeer(undefined, ['http://127.0.0.1:1']), 'http://127.0.0.1:1')
  assert.throws(() => resolvePeer('http://127.0.0.1:9', ['http://127.0.0.1:1']), /没有配对/)
  const prompts = []
  const peer = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-b', title: '部署脚本' }]
    },
    async prompt(sessionId, text) {
      prompts.push({ sessionId, text })
      return { accepted: true, sessionId }
    },
  })
  try {
    const tool = createAhoyTool(() => [`http://127.0.0.1:${peer.port}`])
    const summary = await tool.execute({ text: '看一下部署脚本' })
    assert.equal(summary.includes('session-b'), true)
    assert.equal(summary.includes('工具'), false)
    assert.deepEqual(prompts, [{ sessionId: 'session-b', text: '看一下部署脚本' }])
  } finally {
    await peer.close()
  }
})

test('a revoked pairing token cannot list sessions', async () => {
  const peer = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-b', title: '部署脚本' }]
    },
    async prompt(sessionId) {
      return { accepted: true, sessionId }
    },
  }, { token: 'new-token' })
  const url = `http://127.0.0.1:${peer.port}`
  try {
    await assert.rejects(readPeer(url))
    setPeerToken(url, 'old-token')
    await assert.rejects(readPeer(url))
    setPeerToken(url, 'new-token')
    const status = await readPeer(url)
    assert.equal(status.sessions[0]?.sessionId, 'session-b')
  } finally {
    setPeerToken(url, undefined)
    await peer.close()
  }
})

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
