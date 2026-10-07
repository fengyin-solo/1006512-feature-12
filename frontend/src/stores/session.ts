import { defineStore } from 'pinia'

// 清水池调蓄只认运行班组：归属判定用 crew，经手留痕用 operator。
export const CREW_OPTIONS = ['甲班', '乙班', '丙班'] as const

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '赵磊',
    crew: '甲班',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市供水厂制水运行与供水调度管理平台',
    crewOptions: [...CREW_OPTIONS],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 交接班后切换当前班组：切到别的班组再去动他人池子，就会按越权退回。
    setCrew(crew: string, operator = '') {
      this.crew = crew
      if (operator.trim() !== '') {
        this.operator = operator.trim()
      }
    },
  },
})
