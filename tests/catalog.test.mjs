import assert from 'node:assert/strict'
import test from 'node:test'
import { startPeer } from '../lib/index.js'

test('the peer publishes its model catalog', async () => {
  const peer = await startPeer(0, {
    async list() {
      return []
    },
    async prompt(sessionId) {
      return { accepted: true, sessionId }
    },
    async modelCatalog() {
      return { routableProviders: ['ss'], groups: [{ id: 'ss', models: [{ id: 'flash', name: 'flash' }] }] }
    },
  })
  try {
    const response = await fetch(`http://127.0.0.1:${peer.port}/v1/modelCatalog`, { method: 'POST' })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.routableProviders, ['ss'])
  } finally {
    await peer.close()
  }
})
