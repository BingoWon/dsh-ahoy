import { readFileSync } from 'node:fs'
import { apply, name } from '../lib/index.js'

if (name !== 'dsh-ahoy') throw new Error(`unexpected plugin name: ${name}`)

const labels = []
apply({
  effect(dispose, label) {
    if (typeof dispose !== 'function') throw new Error('effect dispose is not a function')
    labels.push(label)
    return dispose
  },
})
if (!labels.includes('dsh-ahoy: ready')) throw new Error('host plugin did not register')

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
if (!client.includes('window.__ModuleLoader__.load') || !client.includes('id: "dsh-ahoy"')) {
  throw new Error('client bundle is missing the module loader handshake')
}
if (!client.includes('还没有配对的机器')) throw new Error('client bundle is missing the empty machine list')

console.log('dsh-ahoy skeleton ok')
