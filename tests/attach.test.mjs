import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentRemote, cancelRemote, followRemote, forkRemote, listWithPeers, modelRemote, pageRemote, parseRemoteSessionId, projectionRemote, promptRemote, queueRemote, renameRemote, searchWithPeers } from '../lib/attach.js'
import { startPeer } from '../lib/index.js'
import { machineGroupPath, remoteSessionId } from '../lib/tree.js'

test('official list gains the peer session and a prompt goes to that peer', async () => {
  const prompts = []
  const cancels = []
  const peer = await startPeer(0, {
    async list() {
      return [{ sessionId: 'session-b', title: '部署脚本' }, { sessionId: 'ahoy:already', title: '跳过' }]
    },
    async prompt(sessionId, text) {
      prompts.push({ sessionId, text })
      return { accepted: true, sessionId }
    },
    async *follow(sessionId) {
      yield { type: 'event', sessionId, text: '部署脚本' }
    },
    async call(method, sessionId, request) {
      if (method === 'fork') return { sessionId: 'session-fork' }
      return { method, sessionId, title: request?.title, values: { title: request?.title ?? '部署脚本' } }
    },
    async search(query) {
      return [{ sessionId: 'session-b', snippet: query }, { sessionId: 'ahoy:skip', snippet: query }]
    },
    async cancel(sessionId) {
      cancels.push(sessionId)
      return { accepted: true }
    },
    async page(sessionId) {
      return { records: [{ sessionId, text: '部署脚本' }], cursor: 1 }
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
    assert.equal(merged.items[1].cwd, machineGroupPath(url))
    assert.deepEqual(parseRemoteSessionId(remoteId), { peer: url, sessionId: 'session-b' })
    const forwarded = await promptRemote({
      sessionId: remoteId,
      content: [{ type: 'text', text: '看一下部署脚本' }],
    })
    assert.deepEqual(forwarded, { accepted: true })
    assert.deepEqual(prompts, [{ sessionId: 'session-b', text: '看一下部署脚本' }])
    assert.equal(await promptRemote({ sessionId: 'session-a', content: [] }), undefined)
    const page = await pageRemote(remoteId, { maxMessages: 20 })
    assert.equal(page.records[0].sessionId, remoteId)
    assert.equal(page.records[0].text, '部署脚本')
    assert.deepEqual(await cancelRemote(remoteId), { accepted: true })
    assert.deepEqual(cancels, ['session-b'])
    const projection = await projectionRemote(remoteId)
    assert.equal(projection.values.title, '部署脚本')
    const selected = await modelRemote(remoteId, { provider: 'ss', model: 'deepseek-v4-flash' })
    assert.equal(selected.method, 'selectModel')
    assert.equal(selected.sessionId, remoteId)
    const queued = await queueRemote(remoteId, { itemId: 'item-1', action: { kind: 'remove' } })
    assert.equal(queued.method, 'updateQueue')
    assert.equal(queued.sessionId, remoteId)
    const image = await attachmentRemote(remoteId, { attachmentId: 'img-1' })
    assert.equal(image.method, 'attachment')
    assert.equal(image.sessionId, remoteId)
    const forked = await forkRemote(remoteId, {})
    assert.equal(forked.sessionId, remoteSessionId(url, 'session-fork'))
    const found = await searchWithPeers({ items: [] }, [url], '部署')
    assert.deepEqual(found.items, [{ sessionId: remoteId, snippet: '部署' }])
    const renamed = await renameRemote(remoteId, '新标题')
    assert.equal(renamed.title, '新标题')
    assert.equal(renamed.sessionId, remoteId)
    assert.equal(projection.sessionId, remoteId)
    const frames = []
    for await (const frame of followRemote(remoteId, { maxMessages: 5 }, AbortSignal.timeout(2000))) {
      frames.push(frame)
    }
    assert.equal(frames[0].sessionId, remoteId)
    assert.equal(frames[0].text, '部署脚本')
    assert.equal(await cancelRemote('session-a'), undefined)
  } finally {
    await peer.close()
  }
})
