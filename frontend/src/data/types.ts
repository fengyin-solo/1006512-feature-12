/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 清水池调蓄记录：在通用行结构上把水位相关字段收成确定类型，派生字段（蓄水量、生效水位下限）
// 由 clearwell-service 在每次写入时重算，列表页和详情面板读的是同一份。
export type ClearwellRow = EntryRow & {
  池体编号: string
  有效容积: number
  满池水位: number
  当前水位: number
  蓄水量: number
  进出水流量: number
  水位下限: number
  调度水位下限: number | ''
  生效水位下限: number
  运行班次: string
  记录时间: string
  池体状态: string
}

// 只允许本班经手的三个字段。
export type ClearwellLevelPatch = {
  有效容积?: number
  当前水位?: number
  进出水流量?: number
}

// 退回经手记录：每一次被退回的改动都留一条，事后能翻出谁动的、卡在什么上。
export type RejectionRecord = {
  id: number
  time: string
  池体编号: string
  recordId: number | null
  操作班组: string
  归属班组: string
  动作: string
  退回原因: string
}

// 值班交接待办：归属判定的结果回写到这里，接班的人照着核。
export type HandoverTodo = {
  id: number
  time: string
  source: string
  content: string
  done: boolean
}
