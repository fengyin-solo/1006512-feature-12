import { nowStamp } from '@/data/clock'
import { appendHandoverTodo } from '@/data/handover-store'
import { listRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  ClearwellLevelPatch,
  ClearwellRow,
  EntryRow,
  RejectionRecord,
} from '@/data/types'
import { filterRows, moduleMeta } from './local-service'

// 清水池调蓄的规矩全部收在这一层：
// 1. 每条记录只认登记它的运行班组（运行班次字段即归属班组）；
// 2. 有效容积、当前水位、进出水流量只由本班经手，别班递上来的改动算越权，退回并说明卡在什么上；
// 3. 已满池的记录锁死，本班也动不了；
// 4. 水位下限与调度下发的数字打架时，以调度下发的那份为准（生效水位下限）；
// 5. 同一池体编号不许重复登记；
// 6. 每次被退回都留经手记录；归属判定的结果回写值班交接待办。
const KEY = 'clearwell'
const FULL_STATUS = '已满池'
const REJECTION_KEY = 'waterworks-ops:clearwell-rejections'

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// 把存储里的行规范成确定形状：老数据缺字段就补默认值，派生字段一律重算，
// 保证列表页、详情面板、导出读到的是同一份水位。
export function normalizeClearwell(row: EntryRow): ClearwellRow {
  const 有效容积 = toNumber(row.有效容积, 0)
  const rawFull = toNumber(row.满池水位, 0)
  const 满池水位 = rawFull > 0 ? rawFull : 4.5
  const 当前水位 = toNumber(row.当前水位, 0)
  const 水位下限 = toNumber(row.水位下限, 0)
  const rawDispatch = row.调度水位下限
  const 调度水位下限 =
    rawDispatch === undefined || rawDispatch === '' ? ('' as const) : toNumber(rawDispatch, 0)
  // 调度下发的下限优先于本班登记的下限。
  const 生效水位下限 = 调度水位下限 === '' ? 水位下限 : 调度水位下限
  // 蓄水量跟着水位走：按水位占满池水位的比例折算有效容积。
  const 蓄水量 = Math.round((有效容积 * 当前水位) / 满池水位)
  return {
    ...row,
    池体编号: String(row.池体编号 ?? ''),
    有效容积,
    满池水位,
    当前水位,
    蓄水量,
    进出水流量: toNumber(row.进出水流量, 0),
    水位下限,
    调度水位下限,
    生效水位下限,
    运行班次: String(row.运行班次 ?? ''),
    记录时间: String(row.记录时间 ?? ''),
    池体状态: String(row.池体状态 ?? ''),
  }
}

export type ClearwellPage = {
  items: ClearwellRow[]
  total: number
  page: number
  size: number
}

export function listClearwell(filters: Record<string, string> = {}): ClearwellPage {
  // filterRows 只筛不改，行形状不变，这里把类型收回来。
  const matched = filterRows(listRows(KEY).map(normalizeClearwell), filters) as ClearwellRow[]
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getClearwell(id: number): ClearwellRow | null {
  const row = listRows(KEY).find((item) => Number(item.id) === id)
  return row ? normalizeClearwell(row) : null
}

// ---- 退回经手记录 ----

function readRejections(): RejectionRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(REJECTION_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as RejectionRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listRejections(池体编号?: string): RejectionRecord[] {
  const all = readRejections().slice().sort((a, b) => b.id - a.id)
  return 池体编号 ? all.filter((item) => item.池体编号 === 池体编号) : all
}

function logRejection(entry: Omit<RejectionRecord, 'id' | 'time'>): void {
  const all = readRejections()
  const record: RejectionRecord = {
    ...entry,
    id: all.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    time: nowStamp(),
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REJECTION_KEY, JSON.stringify([...all, record]))
  }
}

// ---- 归属闸口 ----

type Ownership =
  | { ok: true; row: ClearwellRow }
  | { ok: false; message: string }

// 每一次经手都先过这道闸：先查锁死，再查归属。退回的同时留经手记录、回写交接待办。
function checkOwnership(id: number, team: string, action: string): Ownership {
  const row = getClearwell(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的清水池调蓄记录` }
  }
  if (String(row.status) === FULL_STATUS) {
    const reason = `记录已确认满池，水位数据锁死，归属班组「${row.运行班次}」也不再受理改动`
    logRejection({
      池体编号: row.池体编号,
      recordId: row.id,
      操作班组: team,
      归属班组: row.运行班次,
      动作: action,
      退回原因: reason,
    })
    appendHandoverTodo(`清水池 ${row.池体编号} 已满池锁死，「${team}」发起的「${action}」被退回`)
    return { ok: false, message: `退回：${reason}` }
  }
  if (row.运行班次 !== team) {
    const reason = `记录归属「${row.运行班次}」，当前班组「${team}」越权：有效容积、当前水位、进出水流量只由本班经手`
    logRejection({
      池体编号: row.池体编号,
      recordId: row.id,
      操作班组: team,
      归属班组: row.运行班次,
      动作: action,
      退回原因: reason,
    })
    appendHandoverTodo(
      `清水池 ${row.池体编号} 归属「${row.运行班次}」，「${team}」发起的「${action}」越权被退回`,
    )
    return { ok: false, message: `退回：${reason}` }
  }
  return { ok: true, row }
}

// ---- 登记 ----

export type RegisterInput = {
  池体编号: string
  有效容积: number
  满池水位: number
  当前水位: number
  进出水流量: number
  水位下限: number
}

export function registerClearwell(input: RegisterInput, team: string): ActionResult {
  const code = input.池体编号.trim()
  if (!code) {
    return { ok: false, message: '池体编号不能为空' }
  }
  const rows = listRows(KEY)
  const duplicate = rows.map(normalizeClearwell).find((row) => row.池体编号 === code)
  if (duplicate) {
    const reason = `池体编号 ${code} 已由记录 #${duplicate.id} 登记，同一池体编号不许重复登记`
    logRejection({
      池体编号: code,
      recordId: duplicate.id,
      操作班组: team,
      归属班组: duplicate.运行班次,
      动作: '登记调蓄记录',
      退回原因: reason,
    })
    appendHandoverTodo(`清水池 ${code} 重复登记被退回：已归属「${duplicate.运行班次}」（记录 #${duplicate.id}）`)
    return { ok: false, message: `退回：${reason}` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row = normalizeClearwell({
    id,
    status: '待蓄水',
    pending: true,
    abnormal: false,
    池体编号: code,
    有效容积: input.有效容积,
    满池水位: input.满池水位,
    当前水位: input.当前水位,
    进出水流量: input.进出水流量,
    水位下限: input.水位下限,
    调度水位下限: '',
    运行班次: team,
    记录时间: nowStamp(),
    池体状态: '正常',
  })
  saveRows(KEY, [...rows, row])
  appendHandoverTodo(`清水池 ${code} 新登记（记录 #${id}），归属「${team}」`)
  return { ok: true, message: `清水池 ${code} 已登记，归属「${team}」，蓄水量 ${row.蓄水量}m³` }
}

// ---- 水位改动（只认本班） ----

export function updateClearwellLevels(
  id: number,
  patch: ClearwellLevelPatch,
  team: string,
): ActionResult {
  const check = checkOwnership(id, team, '修改水位')
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  const { row } = check
  const 有效容积 = patch.有效容积 ?? row.有效容积
  const 当前水位 = patch.当前水位 ?? row.当前水位
  const 进出水流量 = patch.进出水流量 ?? row.进出水流量
  const invalid =
    !Number.isFinite(有效容积) || 有效容积 <= 0
      ? '有效容积必须大于 0'
      : !Number.isFinite(当前水位) || 当前水位 < 0
        ? '当前水位不能为负'
        : 当前水位 > row.满池水位
          ? `当前水位 ${当前水位}m 超过满池水位 ${row.满池水位}m`
          : !Number.isFinite(进出水流量)
            ? '进出水流量必须是数字'
            : null
  if (invalid) {
    const reason = `数值校验不通过：${invalid}`
    logRejection({
      池体编号: row.池体编号,
      recordId: row.id,
      操作班组: team,
      归属班组: row.运行班次,
      动作: '修改水位',
      退回原因: reason,
    })
    return { ok: false, message: `退回：${reason}` }
  }
  const rows = listRows(KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  const updated = normalizeClearwell({
    ...rows[index],
    有效容积,
    当前水位,
    进出水流量,
    记录时间: nowStamp(),
  })
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  appendHandoverTodo(
    `清水池 ${row.池体编号} 归属「${team}」，本班水位改动已放行：当前水位 ${当前水位}m，蓄水量 ${updated.蓄水量}m³`,
  )
  return {
    ok: true,
    message: `已按本班改动更新：当前水位 ${updated.当前水位}m，蓄水量随动为 ${updated.蓄水量}m³`,
  }
}

// ---- 调度下发水位下限（调度渠道，不走班组归属；与本地下限打架时以它为准） ----

export function issueDispatchLimit(id: number, limit: number, team: string): ActionResult {
  const row = getClearwell(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的清水池调蓄记录` }
  }
  if (!Number.isFinite(limit) || limit < 0 || limit > row.满池水位) {
    return { ok: false, message: `调度水位下限需在 0 到满池水位 ${row.满池水位}m 之间` }
  }
  const rows = listRows(KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  const updated = normalizeClearwell({ ...rows[index], 调度水位下限: limit, 记录时间: nowStamp() })
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  appendHandoverTodo(
    `清水池 ${row.池体编号} 调度下发水位下限 ${limit}m（经手「${team}」），生效下限以调度为准：${updated.生效水位下限}m`,
  )
  return {
    ok: true,
    message: `调度水位下限 ${limit}m 已下发，生效水位下限以调度为准：${updated.生效水位下限}m`,
  }
}

// ---- 状态动作（同样过归属闸口） ----

export function runClearwellAction(id: number, action: string, team: string): ActionResult {
  const meta = moduleMeta(KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `清水池调蓄记录没有登记「${action}」这个动作` }
  }
  const check = checkOwnership(id, team, action)
  if (!check.ok) {
    return { ok: false, message: check.message }
  }
  const { row } = check
  if (String(row.status) === target) {
    return { ok: false, message: `清水池调蓄记录已经是「${target}」，不用重复操作` }
  }
  const rows = listRows(KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated = normalizeClearwell({
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: target === '低水位预警',
    记录时间: nowStamp(),
  })
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
  appendHandoverTodo(`清水池 ${row.池体编号} 归属「${team}」，本班执行「${action}」，状态转为「${target}」`)
  return { ok: true, message: `清水池 ${row.池体编号} 已${action}，当前状态「${target}」` }
}

// ---- 导出（与列表同一份规范化数据） ----

export function downloadClearwell(): void {
  const meta = moduleMeta(KEY)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(KEY).map(normalizeClearwell)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${meta.name}-清单.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
