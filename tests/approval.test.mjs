import assert from 'node:assert/strict'
import test from 'node:test'
import { ApprovalDesk, sessionIdFromApproval } from '../lib/index.js'
import { answerPeer, approvalsPeer, startPeer } from '../lib/index.js'

test('an allow clicked here becomes the peer approval outcome', async () => {
  const desk = new ApprovalDesk()
  let local = 0
  const decision = desk.decide('session-b', { toolName: 'bash', reason: '运行脚本' }, () => {
    local += 1
    return 'unavailable'
  })
  const peer = await startPeer(0, {
    async list() {
      return []
    },
    async prompt(sessionId) {
      return { accepted: true, sessionId }
    },
    async approvals() {
      return desk.list()
    },
    async answer(sessionId, outcome) {
      if (!desk.answer(sessionId, outcome)) throw new Error('没有等待中的审批')
      return { accepted: true }
    },
  })
  try {
    const url = `http://127.0.0.1:${peer.port}`
    const pending = await approvalsPeer(url)
    assert.equal(pending[0]?.toolName, 'bash')
    assert.equal(sessionIdFromApproval({ agent: { session: { header: { id: 'session-b' } } } }), 'session-b')
    await answerPeer(url, 'session-b', 'allowed-once')
    assert.equal(await decision, 'allowed-once')
    assert.equal(local, 0)
    await assert.rejects(answerPeer(url, 'missing', 'rejected'))
  } finally {
    await peer.close()
  }
})
