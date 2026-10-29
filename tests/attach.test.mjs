import assert from 'node:assert/strict'
import test from 'node:test'
import { listWithPeers, parseRemoteSessionId, promptRemote } from '../lib/attach.js'
import { startPeer } from '../lib/index.js'
import { remoteSessionId } from '../lib/tree.js'

test('official list gains the peer session and a prompt goes to that peer', async () => {
  const prompts = []
  const peer = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-b', title: '部署脚本' }, { sessionId: 'ahoy:already', title: '跳过' }]
    },
    async prompt(sessionId, text) {
      prompts.push({ sessionId, text })
      return { accepted: true, sessionId }
    },
  })
  try {
    const url = `http://127.0.0.1:${peer.port}`
    const merged = await listWithPeers({
      items: [{ sessionId: 'session-a', title: '本机' }],
    }, [url])
    const remoteId = remoteSessionId(url, 'session-b')
    assert.deepEqual(merged.items.map(item => item.sessionId), ['session-a', remoteId])
    assert.equal(merged.items[1].projections.values.title, '部署脚本')
    assert.deepEqual(parseRemoteSessionId(remoteId), { peer: url, sessionId: 'session-b' })
    const forwarded = await promptRemote({
      sessionId: remoteId,
      content: [{ type: 'text', text: '看一下部署脚本' }],
    })
    assert.deepEqual(forwarded, { accepted: true })
    assert.deepEqual(prompts, [{ sessionId: 'session-b', text: '看一下部署脚本' }])
    assert.equal(await promptRemote({ sessionId: 'session-a', content: [] }), undefined)
  } finally {
    await peer.close()
  }
})
