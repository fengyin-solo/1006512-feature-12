import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listCollection, listRows, resetRows, saveCollection, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  Actor,
  ClearwellAudit,
  ClearwellViewRow,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ShiftTodo,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const CLEARWELL_KEY = 'clearwell'
const DISPATCH_KEY = 'dispatch'
const FULL_STATUS = '已满池'
const AUDIT_STORAGE_KEY = 'waterworks-ops:clearwell-audits:v1'
const TODO_STORAGE_KEY = 'waterworks-ops:shift-todos:v1'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------------------------------------------------------------------------
// 清水池调蓄规矩：归属判定、满池锁死、调度下限优先、蓄水量联动、经手留痕、
// 归属判定回写值班交接待办。列表页与详情面板统一走这里的投影，口径只有一份。
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  const text = String(value ?? '').trim()
  return text === '' ? Number.NaN : Number(text)
}

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 蓄水量按线性池体折算：有效容积 × 当前水位 / 水位上限，四舍五入到整立方米。
// 水位一动手，蓄水量由这里跟着变，页面不允许自己另算一套。
export function storageFor(volume: number, level: number, levelMax: number): number {
  if (![volume, level, levelMax].every(Number.isFinite) || levelMax <= 0) {
    return 0
  }
  return Math.round((volume * level) / levelMax)
}

// 调度已下发（非「待下达」）的指令里，找该池体最新一份带水位下限的指令。
function dispatchLimitFor(poolCode: string): { limit: number; orderNo: string; time: string } | null {
  const issued = listRows(DISPATCH_KEY)
    .filter(
      (row) =>
        String(row['适用池体'] ?? '').trim() === poolCode &&
        String(row.status) !== '待下达',
    )
    .map((row) => ({
      limit: toNumber(row['下发水位下限']),
      orderNo: String(row['调度编号'] ?? ''),
      time: String(row['下达时间'] ?? ''),
    }))
    .filter((item) => Number.isFinite(item.limit))
  if (issued.length === 0) {
    return null
  }
  issued.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0))
  return issued[0]
}

// 唯一的列表/详情投影：有效下限在这里裁一次，蓄水量在这里算一次，
// 列表页和详情面板都只能读到这份结果，从根上杜绝两处水位对不上。
function toViewRow(row: EntryRow): ClearwellViewRow {
  const code = String(row['池体编号'] ?? '')
  const volume = toNumber(row['有效容积'])
  const levelMax = toNumber(row['水位上限'])
  const localMin = toNumber(row['水位下限'])
  const level = toNumber(row['当前水位'])
  const dispatch = dispatchLimitFor(code)
  const dispatchMin = dispatch?.limit ?? null
  // 本班登记的下限与调度下发的下限打架时，以调度下发的那份为准。
  const applicable = dispatchMin ?? localMin
  return {
    ...row,
    池体编号: code,
    有效容积: volume,
    水位上限: levelMax,
    水位下限: localMin,
    当前水位: level,
    蓄水量: storageFor(volume, level, levelMax),
    进出水流量: String(row['进出水流量'] ?? ''),
    运行班组: String(row['运行班组'] ?? ''),
    运行班次: String(row['运行班次'] ?? ''),
    记录时间: String(row['记录时间'] ?? ''),
    调度下限: dispatchMin,
    适用下限: applicable,
    下限来源: dispatchMin === null ? '本班登记' : '调度下发',
  }
}

export function listClearwellRows(filters: Record<string, string> = {}): ClearwellViewRow[] {
  return filterRows(listRows(CLEARWELL_KEY), filters).map(toViewRow)
}

export function getClearwellDetail(id: number): ClearwellViewRow | null {
  const row = listRows(CLEARWELL_KEY).find((item) => Number(item.id) === id)
  return row ? toViewRow(row) : null
}

function listAudits(): ClearwellAudit[] {
  return listCollection<ClearwellAudit>(AUDIT_STORAGE_KEY)
}

// 每次被退回都要留下经手记录；成功经手同样留痕，事后翻得到是谁动的。
function appendAudit(entry: Omit<ClearwellAudit, 'id' | 'time'>): void {
  const audits = listAudits()
  const nextId = audits.reduce((max, item) => Math.max(max, item.id), 0) + 1
  audits.unshift({ id: nextId, time: nowText(), ...entry })
  saveCollection(AUDIT_STORAGE_KEY, audits)
}

export function listClearwellAudits(poolCode = ''): ClearwellAudit[] {
  const audits = listAudits()
  return poolCode.trim() === ''
    ? audits
    : audits.filter((item) => item.池体编号 === poolCode.trim())
}

function listTodos(): ShiftTodo[] {
  return listCollection<ShiftTodo>(TODO_STORAGE_KEY)
}

function appendTodo(todo: Omit<ShiftTodo, 'id' | 'time' | '状态'>): void {
  const todos = listTodos()
  const nextId = todos.reduce((max, item) => Math.max(max, item.id), 0) + 1
  todos.unshift({ id: nextId, time: nowText(), 状态: '待承办', ...todo })
  saveCollection(TODO_STORAGE_KEY, todos)
}

export function listShiftTodos(crew = ''): ShiftTodo[] {
  const todos = listTodos()
  return crew.trim() === '' ? todos : todos.filter((item) => item.承办班组 === crew.trim())
}

// 归属班组在交接班时办结待办。
export function resolveShiftTodo(id: number): ActionResult {
  const todos = listTodos()
  const index = todos.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条值班待办' }
  }
  todos[index] = { ...todos[index], 状态: '已办结' }
  saveCollection(TODO_STORAGE_KEY, todos)
  return { ok: true, message: `池体 ${todos[index].池体编号} 的归属待办已办结` }
}

export type ClearwellDraft = {
  池体编号: string
  有效容积: string | number
  水位上限: string | number
  水位下限: string | number
  当前水位: string | number
  进出水流量: string
}

// 同一条池体编号不许重复登记。
export function registerClearwell(draft: ClearwellDraft, actor: Actor): ActionResult {
  const code = draft.池体编号.trim()
  const action = '登记调蓄记录'
  const fail = (reason: string, detail = ''): ActionResult => {
    appendAudit({
      池体编号: code || '（未填编号）',
      动作: action,
      经手班组: actor.crew,
      经手人: actor.operator,
      结果: '退回',
      卡在哪: reason,
      详情: detail,
    })
    return { ok: false, message: `登记已退回：${reason}` }
  }

  if (code === '') {
    return fail('池体编号为空，没法登记')
  }
  if (listRows(CLEARWELL_KEY).some((row) => String(row['池体编号'] ?? '').trim() === code)) {
    return fail(
      `池体编号 ${code} 重复登记`,
      '同一条池体编号只许登记一条调蓄记录',
    )
  }

  const volume = toNumber(draft.有效容积)
  const levelMax = toNumber(draft.水位上限)
  const localMin = toNumber(draft.水位下限)
  const level = toNumber(draft.当前水位)
  if (!Number.isFinite(volume) || volume <= 0) {
    return fail('有效容积必须是大于 0 的数字（m³）')
  }
  if (!Number.isFinite(levelMax) || levelMax <= 0) {
    return fail('水位上限必须是大于 0 的数字（m）')
  }
  if (!Number.isFinite(localMin) || localMin < 0 || localMin >= levelMax) {
    return fail('水位下限必须是不小于 0 且小于水位上限的数字（m）')
  }
  if (!Number.isFinite(level) || level < 0 || level > levelMax) {
    return fail(`当前水位必须在 0 ~ ${levelMax}m 之间`)
  }

  const rows = listRows(CLEARWELL_KEY)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待蓄水',
    pending: true,
    abnormal: false,
    池体编号: code,
    有效容积: volume,
    水位上限: levelMax,
    水位下限: localMin,
    当前水位: level,
    蓄水量: storageFor(volume, level, levelMax),
    进出水流量: draft.进出水流量.trim(),
    // 每条调蓄记录只认登记它的那个运行班组。
    运行班组: actor.crew,
    运行班次: '本班登记',
    记录时间: nowText(),
  }
  saveRows(CLEARWELL_KEY, [...rows, row])
  appendAudit({
    池体编号: code,
    动作: action,
    经手班组: actor.crew,
    经手人: actor.operator,
    结果: '通过',
    卡在哪: '',
    详情: `水位 ${level}m / 上限 ${levelMax}m，本班登记下限 ${localMin}m，蓄水量 ${row.蓄水量}m³`,
  })
  return { ok: true, message: `池体 ${code} 已由${actor.crew}登记，当前蓄水量 ${row.蓄水量}m³` }
}

export type ClearwellAdjustment = {
  有效容积?: string | number
  当前水位?: string | number
  进出水流量?: string
}

// 有效容积、当前水位与进出水流量只由本班经手；越权退回、满池锁死、下限拦截依次把关。
export function adjustClearwell(
  id: number,
  changes: ClearwellAdjustment,
  actor: Actor,
): ActionResult {
  const rows = listRows(CLEARWELL_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  const action = '调整水位/容积/流量'
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的清水池调蓄记录` }
  }
  const raw = rows[index]
  const code = String(raw['池体编号'] ?? '')
  const owner = String(raw['运行班组'] ?? '')

  const reject = (reason: string, detail = ''): ActionResult => {
    appendAudit({
      池体编号: code,
      动作: action,
      经手班组: actor.crew,
      经手人: actor.operator,
      结果: '退回',
      卡在哪: reason,
      详情: detail,
    })
    return { ok: false, message: `改动已退回：${reason}` }
  }

  // 第一道：归属判定。别的班组递上来的改动算越权，并回写值班交接待办。
  if (owner !== actor.crew) {
    const reason = `越权操作：池体 ${code} 归${owner}经手，${actor.crew}无权改动有效容积、当前水位与进出水流量`
    appendAudit({
      池体编号: code,
      动作: action,
      经手班组: actor.crew,
      经手人: actor.operator,
      结果: '退回',
      卡在哪: reason,
      详情: `归属班组=${owner}，申请班组=${actor.crew}`,
    })
    appendTodo({
      池体编号: code,
      事项: `【越权退回】${actor.crew}（${actor.operator}）申请改动池体 ${code}，该池归${owner}经手，已退回。请${owner}核对水位与蓄水量。`,
      来源班组: actor.crew,
      承办班组: owner,
    })
    return { ok: false, message: `改动已退回：${reason}` }
  }

  // 第二道：已经满池的记录锁死，本班也动不了。
  if (String(raw.status) === FULL_STATUS) {
    return reject(
      `池体 ${code} 已满池锁死，有效容积、当前水位与进出水流量一律不得改动（本班也不行）`,
      `状态=${FULL_STATUS}`,
    )
  }

  const view = toViewRow(raw)
  const updated: EntryRow = { ...raw }
  const notes: string[] = []

  if (changes.有效容积 !== undefined) {
    const volume = toNumber(changes.有效容积)
    if (!Number.isFinite(volume) || volume <= 0) {
      return reject('有效容积必须是大于 0 的数字（m³）')
    }
    updated['有效容积'] = volume
    notes.push(`有效容积 ${view.有效容积}→${volume}m³`)
  }
  if (changes.进出水流量 !== undefined) {
    const flow = changes.进出水流量.trim()
    if (flow === '') {
      return reject('进出水流量不能为空')
    }
    updated['进出水流量'] = flow
    notes.push(`流量改为「${flow}」`)
  }
  if (changes.当前水位 !== undefined) {
    const level = toNumber(changes.当前水位)
    if (!Number.isFinite(level) || level < 0 || level > view.水位上限) {
      return reject(`当前水位必须在 0 ~ ${view.水位上限}m 之间`)
    }
    // 第三道：水位下限与调度下发的数字打架时，以调度下发的那份为准。
    if (level < view.适用下限) {
      const conflict =
        view.调度下限 !== null && view.调度下限 !== view.水位下限
          ? `本班登记下限 ${view.水位下限}m 与调度下发下限 ${view.调度下限}m 打架，以调度下发为准；`
          : ''
      return reject(
        `当前水位 ${level}m 低于适用下限 ${view.适用下限}m（来源：${view.下限来源}），卡在水位下线上`,
        `${conflict}改后水位必须 ≥ ${view.适用下限}m`,
      )
    }
    updated['当前水位'] = level
    notes.push(`水位 ${view.当前水位}→${level}m`)
  }

  // 水位一动手，蓄水量跟着变（容积改动同样重算），写回存储。
  const nextVolume = toNumber(updated['有效容积'])
  const nextLevel = toNumber(updated['当前水位'])
  updated['蓄水量'] = storageFor(nextVolume, nextLevel, view.水位上限)
  notes.push(`蓄水量核定为 ${updated['蓄水量']}m³`)

  const next = [...rows]
  next[index] = updated
  saveRows(CLEARWELL_KEY, next)
  appendAudit({
    池体编号: code,
    动作: action,
    经手班组: actor.crew,
    经手人: actor.operator,
    结果: '通过',
    卡在哪: '',
    详情: notes.join('；'),
  })
  return { ok: true, message: `${actor.crew}改动已生效，池体 ${code} 当前水位 ${nextLevel}m，蓄水量 ${updated['蓄水量']}m³` }
}

// 满池锁死同样压住状态流转：谁都不能把已满池的记录拨回别的状态。
export function changeClearwellStatus(id: number, action: string, actor: Actor): ActionResult {
  const meta = moduleMeta(CLEARWELL_KEY)
  const target = meta.actionTargets[action]
  const row = listRows(CLEARWELL_KEY).find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的清水池调蓄记录` }
  }
  const code = String(row['池体编号'] ?? '')
  if (String(row.status) === FULL_STATUS && target && target !== FULL_STATUS) {
    const reason = `池体 ${code} 已满池锁死，不允许执行「${action}」改状态（本班也不行）`
    appendAudit({
      池体编号: code,
      动作: `状态动作：${action}`,
      经手班组: actor.crew,
      经手人: actor.operator,
      结果: '退回',
      卡在哪: reason,
      详情: `当前状态=${FULL_STATUS}`,
    })
    return { ok: false, message: `操作已退回：${reason}` }
  }
  return runAction(CLEARWELL_KEY, id, action)
}
