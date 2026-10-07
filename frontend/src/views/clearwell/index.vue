<template>
  <section class="page" data-module="clearwell">
    <header class="page-head">
      <div>
        <h2>清水池调蓄管理</h2>
        <p class="page-desc">
          每条调蓄记录只认登记它的运行班组：有效容积、当前水位、进出水流量只由本班经手，越权与满池改动一律退回并留痕。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清水池调蓄记录</button>
        <button class="btn" type="button" @click="exportRows">导出清水池调蓄清单</button>
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

    <p v-if="errorMessage" class="page-banner error-text">{{ errorMessage }}</p>
    <p v-if="noticeMessage" class="page-banner success-text">{{ noticeMessage }}</p>

    <div class="layout-split">
      <div class="layout-main">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              :class="{ selected: selectedId === Number(row.id) }"
              @click="selectRow(row)"
            >
              <td>{{ row.池体编号 }}</td>
              <td>{{ fmtVolume(row.有效容积) }}</td>
              <td>{{ fmtLevel(row.当前水位) }}</td>
              <td>{{ fmtVolume(row.蓄水量) }}</td>
              <td>{{ fmtLevel(row.生效水位下限) }}</td>
              <td>{{ fmtFlow(row.进出水流量) }}</td>
              <td>
                {{ row.运行班次 }}
                <span v-if="row.运行班次 === session.team" class="badge owner">本班</span>
              </td>
              <td>{{ row.记录时间 }}</td>
              <td>
                {{ row.status }}
                <span v-if="row.status === FULL_STATUS" class="badge locked">锁死</span>
              </td>
              <td class="row-actions" @click.stop>
                <button class="link" type="button" @click="selectRow(row)">详情</button>
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
              <td :colspan="columns.length + 2" class="empty-state">暂无清水池调蓄数据，可先登记清水池调蓄记录</td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside v-if="detail" class="detail-panel">
        <h3>
          调蓄详情 · {{ detail.池体编号 }}
          <span v-if="detail.status === FULL_STATUS" class="badge locked">已满池锁死</span>
          <span v-else-if="detail.运行班次 === session.team" class="badge owner">本班记录</span>
          <span v-else class="badge foreign">归属{{ detail.运行班次 }}</span>
        </h3>
        <dl class="detail-grid">
          <dt>归属班组</dt>
          <dd>{{ detail.运行班次 }}</dd>
          <dt>有效容积</dt>
          <dd>{{ fmtVolume(detail.有效容积) }}</dd>
          <dt>满池水位</dt>
          <dd>{{ fmtLevel(detail.满池水位) }}</dd>
          <dt>当前水位</dt>
          <dd>{{ fmtLevel(detail.当前水位) }}</dd>
          <dt>蓄水量</dt>
          <dd>{{ fmtVolume(detail.蓄水量) }}</dd>
          <dt>进出水流量</dt>
          <dd>{{ fmtFlow(detail.进出水流量) }}</dd>
          <dt>水位下限（本班登记）</dt>
          <dd>{{ fmtLevel(detail.水位下限) }}</dd>
          <dt>调度水位下限</dt>
          <dd>{{ detail.调度水位下限 === '' ? '调度未下发' : fmtLevel(detail.调度水位下限) }}</dd>
          <dt>生效水位下限</dt>
          <dd>
            <strong>{{ fmtLevel(detail.生效水位下限) }}</strong>
            <span class="muted-text">
              {{ detail.调度水位下限 === '' ? '（按本班登记执行）' : '（与登记值打架时以调度下发为准）' }}
            </span>
          </dd>
          <dt>记录时间</dt>
          <dd>{{ detail.记录时间 }}</dd>
          <dt>池体状态</dt>
          <dd>{{ detail.池体状态 }}</dd>
        </dl>
        <p v-if="levelWarning" class="warning-text">
          当前水位低于生效水位下限 {{ fmtLevel(detail.生效水位下限) }}，建议执行「上报预警」。
        </p>

        <h4>本班经手 · 修改水位</h4>
        <form class="edit-form" @submit.prevent="saveLevels">
          <label>
            有效容积（m³）
            <input v-model="levelForm.有效容积" type="number" step="1" min="1" required />
          </label>
          <label>
            当前水位（m）
            <input v-model="levelForm.当前水位" type="number" step="0.01" min="0" required />
          </label>
          <label>
            进出水流量（m³/h，负数为出水）
            <input v-model="levelForm.进出水流量" type="number" step="1" required />
          </label>
          <button class="btn primary" type="submit">以「{{ session.team }}」名义保存</button>
          <p class="muted-text">蓄水量随水位自动折算；满池记录锁死，本班也保存不了。</p>
        </form>

        <h4>调度下发 · 水位下限</h4>
        <form class="edit-form" @submit.prevent="issueLimit">
          <label>
            调度水位下限（m）
            <input v-model="dispatchLimit" type="number" step="0.01" min="0" required />
          </label>
          <button class="btn" type="submit">下发并生效</button>
          <p class="muted-text">与本班登记的水位下限打架时，以调度下发的这份为准。</p>
        </form>

        <template v-if="detailRejections.length">
          <h4>本池退回经手记录</h4>
          <ul class="rejection-list">
            <li v-for="item in detailRejections" :key="item.id">
              <span class="todo-time">{{ item.time }}</span>
              {{ item.操作班组 }}「{{ item.动作 }}」被退回：{{ item.退回原因 }}
            </li>
          </ul>
        </template>
      </aside>
    </div>

    <section class="rejection-panel">
      <h3>退回经手记录（最近 {{ rejections.length }} 条）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>池体编号</th>
            <th>操作班组</th>
            <th>归属班组</th>
            <th>动作</th>
            <th>退回原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rejections" :key="item.id">
            <td>{{ item.time }}</td>
            <td>{{ item.池体编号 }}</td>
            <td>{{ item.操作班组 }}</td>
            <td>{{ item.归属班组 }}</td>
            <td>{{ item.动作 }}</td>
            <td>{{ item.退回原因 }}</td>
          </tr>
          <tr v-if="!rejections.length">
            <td colspan="6" class="empty-state">还没有退回记录，说明递上来的改动都过了归属闸口</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记清水池调蓄记录</h3>
        <div class="edit-form">
          <label>
            池体编号
            <input v-model="createForm.池体编号" placeholder="如 CLEA-0004" required />
          </label>
          <label>
            有效容积（m³）
            <input v-model="createForm.有效容积" type="number" step="1" min="1" required />
          </label>
          <label>
            满池水位（m）
            <input v-model="createForm.满池水位" type="number" step="0.01" min="0.1" required />
          </label>
          <label>
            当前水位（m）
            <input v-model="createForm.当前水位" type="number" step="0.01" min="0" required />
          </label>
          <label>
            进出水流量（m³/h）
            <input v-model="createForm.进出水流量" type="number" step="1" required />
          </label>
          <label>
            水位下限（m，本班登记）
            <input v-model="createForm.水位下限" type="number" step="0.01" min="0" required />
          </label>
          <p class="muted-text">
            登记后归属「{{ session.team }}」，之后只有本班能改动水位；同一池体编号不许重复登记。
          </p>
        </div>
        <div class="modal-actions">
          <button class="btn primary" type="submit">确认登记</button>
          <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
        </div>
      </form>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条清水池调蓄记录</span>
      <span>列表与详情面板读同一份本地数据，水位不会出现两张皮</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadClearwell,
  getClearwell,
  issueDispatchLimit,
  listClearwell,
  listRejections,
  registerClearwell,
  runClearwellAction,
  updateClearwellLevels,
} from '@/api/clearwell-service'
import { useSessionStore } from '@/stores/session'
import type { ClearwellRow, RejectionRecord } from '@/data/types'

const FULL_STATUS = '已满池'
const session = useSessionStore()

const columns = ['池体编号', '有效容积', '当前水位', '蓄水量', '生效水位下限', '进出水流量', '归属班组', '记录时间']
const actions = ['提交蓄水', '确认满池', '上报预警']
const statuses = ['待蓄水', '蓄水中', '已满池', '低水位预警']

const rows = ref<ClearwellRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['池体编号', '运行班次', '池体状态']

const selectedId = ref<number | null>(null)
const detail = ref<ClearwellRow | null>(null)
const rejections = ref<RejectionRecord[]>([])
const dispatchLimit = ref('')
const levelForm = reactive({ 有效容积: '', 当前水位: '', 进出水流量: '' })

const showCreate = ref(false)
const createForm = reactive({
  池体编号: '',
  有效容积: '',
  满池水位: '',
  当前水位: '',
  进出水流量: '',
  水位下限: '',
})

const stats = computed(() => [
  { label: '蓄水中池体', value: rows.value.filter((row) => row.status === '蓄水中').length },
  { label: '已满池池体', value: rows.value.filter((row) => row.status === FULL_STATUS).length },
  { label: '低水位预警次数', value: rows.value.filter((row) => row.status === '低水位预警').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const detailRejections = computed(() =>
  detail.value ? rejections.value.filter((item) => item.池体编号 === detail.value?.池体编号) : [],
)

const levelWarning = computed(
  () =>
    detail.value !== null &&
    detail.value.status !== FULL_STATUS &&
    detail.value.当前水位 < detail.value.生效水位下限,
)

function fmtLevel(value: number): string {
  return `${Number(value).toFixed(2)} m`
}

function fmtVolume(value: number): string {
  return `${Math.round(Number(value)).toLocaleString()} m³`
}

function fmtFlow(value: number): string {
  return `${Number(value)} m³/h`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadClearwell()
}

function openCreate() {
  showCreate.value = true
}

function selectRow(row: ClearwellRow) {
  selectedId.value = Number(row.id)
  refreshDetail()
}

// 详情面板与列表读的是同一份本地数据（localStorage 里的 entries），
// 每次改动后一起刷新，两边的水位永远一致。
function refreshDetail() {
  if (selectedId.value === null) {
    detail.value = null
    return
  }
  detail.value = getClearwell(selectedId.value)
  if (detail.value) {
    levelForm.有效容积 = String(detail.value.有效容积)
    levelForm.当前水位 = String(detail.value.当前水位)
    levelForm.进出水流量 = String(detail.value.进出水流量)
    dispatchLimit.value = detail.value.调度水位下限 === '' ? '' : String(detail.value.调度水位下限)
  }
}

function handleResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
  reload()
}

function saveLevels() {
  if (selectedId.value === null) {
    return
  }
  const result = updateClearwellLevels(
    selectedId.value,
    {
      有效容积: Number(levelForm.有效容积),
      当前水位: Number(levelForm.当前水位),
      进出水流量: Number(levelForm.进出水流量),
    },
    session.team,
  )
  handleResult(result)
}

function issueLimit() {
  if (selectedId.value === null) {
    return
  }
  handleResult(issueDispatchLimit(selectedId.value, Number(dispatchLimit.value), session.team))
}

function submitCreate() {
  const result = registerClearwell(
    {
      池体编号: createForm.池体编号,
      有效容积: Number(createForm.有效容积),
      满池水位: Number(createForm.满池水位),
      当前水位: Number(createForm.当前水位),
      进出水流量: Number(createForm.进出水流量),
      水位下限: Number(createForm.水位下限),
    },
    session.team,
  )
  if (result.ok) {
    showCreate.value = false
    createForm.池体编号 = ''
    createForm.有效容积 = ''
    createForm.满池水位 = ''
    createForm.当前水位 = ''
    createForm.进出水流量 = ''
    createForm.水位下限 = ''
  }
  handleResult(result)
}

function runAction(action: string, row: ClearwellRow) {
  handleResult(runClearwellAction(Number(row.id), action, session.team))
}

function reload() {
  try {
    const payload = listClearwell(filters.value)
    rows.value = payload.items
    total.value = payload.total
    rejections.value = listRejections().slice(0, 20)
    refreshDetail()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清水池调蓄列表读取失败'
  }
}

onMounted(reload)
</script>
