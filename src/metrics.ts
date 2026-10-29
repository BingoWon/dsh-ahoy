import { cpus, freemem, totalmem } from 'node:os'
import { statfsSync } from 'node:fs'

export interface MachineStatus {
  cpuPercent: number | null
  memoryUsedBytes: number
  memoryTotalBytes: number
  diskUsedBytes: number | null
  diskTotalBytes: number | null
}

interface CpuTimes {
  idle: number
  user: number
  sys: number
  nice: number
  irq: number
}

let previous: CpuTimes[] | undefined

function totalOf(times: CpuTimes): number {
  return times.idle + times.user + times.sys + times.nice + times.irq
}

/** 两次读取之间的 CPU 忙比例。第一次调用只记下起点，不假装有百分比。 */
export function readCpuPercent(): number | null {
  const now = cpus().map(cpu => cpu.times)
  const before = previous
  previous = now
  if (before === undefined || before.length !== now.length) return null
  let idle = 0
  let total = 0
  for (let index = 0; index < now.length; index += 1) {
    const next = now[index]
    const last = before[index]
    if (next === undefined || last === undefined) continue
    idle += next.idle - last.idle
    total += totalOf(next) - totalOf(last)
  }
  if (total <= 0) return null
  return Math.max(0, Math.min(100, (1 - idle / total) * 100))
}

export function readMachineStatus(path = '/'): MachineStatus {
  const memoryTotalBytes = totalmem()
  let diskUsedBytes: number | null = null
  let diskTotalBytes: number | null = null
  try {
    const stats = statfsSync(path)
    diskTotalBytes = stats.blocks * stats.bsize
    diskUsedBytes = (stats.blocks - stats.bfree) * stats.bsize
  } catch {
    diskUsedBytes = null
    diskTotalBytes = null
  }
  return {
    cpuPercent: readCpuPercent(),
    memoryUsedBytes: memoryTotalBytes - freemem(),
    memoryTotalBytes,
    diskUsedBytes,
    diskTotalBytes,
  }
}
