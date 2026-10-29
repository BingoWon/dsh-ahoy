import assert from 'node:assert/strict'
import test from 'node:test'
import { activePeers, peerConfigPath, peerRefs, peerUrls, profileDirFromArgv, profileDirFromStack } from '../lib/peers.js'

test('env peers win, otherwise the profile file is used', () => {
  assert.deepEqual(peerUrls('http://127.0.0.1:1, http://127.0.0.1:2', '{"peers":["http://127.0.0.1:9"]}'), [
    'http://127.0.0.1:1',
    'http://127.0.0.1:2',
  ])
  assert.deepEqual(peerUrls(undefined, '{"peers":[" http://127.0.0.1:47341 "]}'), ['http://127.0.0.1:47341'])
  assert.deepEqual(peerRefs(undefined, '{"peers":[{"url":"http://127.0.0.1:47341","token":"new-token"}]}'), [
    { url: 'http://127.0.0.1:47341', token: 'new-token' },
  ])
  assert.deepEqual(peerUrls('', 'not json'), [])
  assert.equal(peerConfigPath('/Users/bingo/.dsh/profiles/desktop'), '/Users/bingo/.dsh/profiles/desktop/ahoy-peers.json')
  assert.equal(peerConfigPath(undefined), undefined)
  const peers = [{ url: 'http://127.0.0.1:1', expiresAt: 10 }, { url: 'http://127.0.0.1:2', expiresAt: 30 }]
  assert.deepEqual(activePeers(peers, 20).map(peer => peer.url), ['http://127.0.0.1:2'])
  assert.deepEqual(peerUrls(undefined, '{"peers":[{"url":"http://127.0.0.1:1","expiresAt":1}]}', 20), [])
  assert.equal(
    profileDirFromStack('at file:///Users/bingo/.dsh/profiles/ahoy-a/#dsh-ahoy'),
    '/Users/bingo/.dsh/profiles/ahoy-a',
  )
  assert.equal(profileDirFromStack('at file:///tmp/other.js'), undefined)
  assert.equal(
    profileDirFromArgv(['dsh', '--profile', 'ahoy-a', '--port', '1'], '/Users/bingo/.dsh'),
    '/Users/bingo/.dsh/profiles/ahoy-a',
  )
})
