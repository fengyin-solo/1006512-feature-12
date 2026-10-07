<template>
  <section class="page" data-module="shift">
    <header class="page-head">
      <div>
        <h2>值班交接班管理</h2>
        <p class="page-desc">维护交接班记录，围绕交接编号、值班班组、班次、交班人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记交接班记录</button>
        <button class="btn" type="button" @click="exportRows">导出值班交接班清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无值班交接班数据，可先登记交接班记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条值班交接班记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="todo-section">
      <h3>值班交接待办（清水池归属判定回写）</h3>
      <p class="page-desc">
        别的班组申请改动非本班组清水池被退回时，归属判定动作回写到这里，承办给池体所属运行班组。
        当前运行班组：{{ session.crew }}
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>回写时间</th>
            <th>池体编号</th>
            <th>事项</th>
            <th>来源班组</th>
            <th>承办班组</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.id" :class="{ 'todo-mine': todo.承办班组 === session.crew && todo.状态 === '待承办' }">
            <td>{{ todo.time }}</td>
            <td>{{ todo.池体编号 }}</td>
            <td>{{ todo.事项 }}</td>
            <td>{{ todo.来源班组 }}</td>
            <td>{{ todo.承办班组 }}</td>
            <td>{{ todo.状态 }}</td>
            <td>
              <button
                v-if="todo.状态 === '待承办' && todo.承办班组 === session.crew"
                class="link"
                type="button"
                @click="finishTodo(todo.id)"
              >
                交接办结
              </button>
              <span v-else class="muted-text">—</span>
            </td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="7" class="empty-state">暂无归属判定待办</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listShiftTodos,
  moduleMeta,
  resolveShiftTodo,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, ShiftTodo } from '@/data/types'

const meta = moduleMeta('shift')
const session = useSessionStore()
const columns = ["交接编号", "值班班组", "班次", "交班人员", "接班人员", "交接事项", "交接时间", "交接状态"]
const actions = ["发起交接", "确认交接", "登记遗留"]
const statuses = ["待交接", "交接中", "已交接", "有遗留"]
const stats = [{"label": "待交接班次", "value": 0}, {"label": "已交接班次", "value": 0}, {"label": "有遗留事项", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '交接班记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

const todos = ref<ShiftTodo[]>([])

function reloadTodos() {
  // 值班交接页看全量待办，哪个班组承办一目了然；办结只给承办本班。
  todos.value = listShiftTodos()
}

function finishTodo(id: number) {
  const result = resolveShiftTodo(id)
  errorMessage.value = result.ok ? '' : result.message
  reloadTodos()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '值班交接班列表读取失败'
  }
  reloadTodos()
}

onMounted(() => {
  reload()
  reloadTodos()
})
</script>
