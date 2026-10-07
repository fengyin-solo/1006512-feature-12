/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | null
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

// 当前登录值班身份：清水池调蓄的归属判定只认「运行班组」。
export type Actor = {
  crew: string
  operator: string
}

// 清水池列表明细：列表页与详情面板统一由 listClearwellRows/getClearwellDetail 投影，
// 蓄水量等联动字段都在这一层算好，两处读到的水位、蓄水量保证一致。
export type ClearwellViewRow = EntryRow & {
  池体编号: string
  有效容积: number
  水位上限: number
  水位下限: number
  当前水位: number
  蓄水量: number
  进出水流量: string
  运行班组: string
  运行班次: string
  记录时间: string
  调度下限: number | null
  适用下限: number
  下限来源: '调度下发' | '本班登记'
}

// 每次退回（以及每次成功经手）都要留下的经手记录。
export type ClearwellAudit = {
  id: number
  time: string
  池体编号: string
  动作: string
  经手班组: string
  经手人: string
  结果: '通过' | '退回'
  卡在哪: string
  详情: string
}

// 归属判定（越权退回）回写到值班交接的待办。
export type ShiftTodo = {
  id: number
  time: string
  池体编号: string
  事项: string
  来源班组: string
  承办班组: string
  状态: '待承办' | '已办结'
}
