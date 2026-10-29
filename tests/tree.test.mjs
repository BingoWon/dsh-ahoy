import assert from 'node:assert/strict'
import test from 'node:test'
import { framesForNewSessions, remoteSessionId } from '../lib/tree.js'

test('remote sessions are announced once, with a title', () => {
  const seen = new Set()
  const first = framesForNewSessions(seen, [
    { peer: 'http://127.0.0.1:47331', sessionId: 'session-b', title: '部署脚本' },
  ])
  assert.deepEqual(first, [
    {
      type: 'host/session-added',
      sessionId: remoteSessionId('http://127.0.0.1:47331', 'session-b'),
      blank: false,
    },
    {
      type: 'session/projection',
      sessionId: remoteSessionId('http://127.0.0.1:47331', 'session-b'),
      key: 'title',
      value: '部署脚本',
      seq: 0,
    },
  ])
  assert.deepEqual(framesForNewSessions(seen, [
    { peer: 'http://127.0.0.1:47331', sessionId: 'session-b', title: '部署脚本' },
  ]), [])
})
