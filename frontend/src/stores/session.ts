import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    // 当前在岗班组：清水池调蓄的归属判定以它为准，登记记录时写作归属班组。
    team: '运行一班',
    teams: ['运行一班', '运行二班', '运行三班'],
    scope: '城市供水厂制水运行与供水调度管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTeam(team: string) {
      if (this.teams.includes(team)) {
        this.team = team
      }
    },
  },
})
