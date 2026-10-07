<template>
  <section class="page" data-module="clearwell">
    <header class="page-head">
      <div>
        <h2>清水池调蓄管理</h2>
        <p class="page-desc">
          每条调蓄记录只认登记它的运行班组，有效容积、当前水位与进出水流量只由本班经手；
          越权改动直接退回，满池记录本班也动不了；水位下限与调度下发打架时以调度下发为准。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记清水池调蓄记录</button>
        <button class="btn" type="button" @click="exportRows">导出清水池调蓄清单</button>
      </div>
    </header>

    <div class="rule-bar">
      <span>当前运行班组：<strong>{{ actor.crew }}</strong>（{{ actor.operator }}）</span>
      <span>只可经手本班组登记的池体；已满池记录锁死。</span>
    </div>

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
      <label class="filter-item">
        <span>池体编号</span>
        <input v-model="filters['池体编号']" placeholder="按池体编号检索" />
      </label>
      <label class="filter-item">
        <span>运行班组</span>
        <input v-model="filters['运行班组']" placeholder="按运行班组检索" />
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
          <td>{{ row.池体编号 }}</td>
          <td>{{ row.有效容积 }} m³</td>
          <td>{{ row.当前水位 }} / {{ row.水位上限 }} m</td>
          <td>{{ row.蓄水量 }} m³</td>
          <td>
            {{ row.适用下限 }} m
            <span :class="['source-tag', row.下限来源 === '调度下发' ? 'src-dispatch' : 'src-local']">
              {{ row.下限来源 }}
            </span>
          </td>
          <td>{{ row.进出水流量 }}</td>
          <td>{{ row.运行班组 }}</td>
          <td>{{ row.记录时间 }}</td>
          <td>
            {{ row.status }}
            <span v-if="row.status === '已满池'" class="lock-tag">已锁死</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <template v-if="row.status !== '已满池'">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="changeStatus(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">满池锁死</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无清水池调蓄数据，可先登记清水池调蓄记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条清水池调蓄记录</span>
      <span v-if="notice" class="error-text">{{ notice }}</span>
    </footer>

    <!-- 登记 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记清水池调蓄记录（归属：{{ actor.crew }}）</h3>
        <p class="modal-hint">同一条池体编号不许重复登记；记录只认登记它的运行班组。</p>
        <div class="form-grid">
          <label>池体编号<input v-model="createForm.池体编号" placeholder="如 CW-104" /></label>
          <label>有效容积（m³）<input v-model="createForm.有效容积" type="number" min="0" /></label>
          <label>水位上限（m）<input v-model="createForm.水位上限" type="number" min="0" step="0.1" /></label>
          <label>本班登记水位下限（m）<input v-model="createForm.水位下限" type="number" min="0" step="0.1" /></label>
          <label>当前水位（m）<input v-model="createForm.当前水位" type="number" min="0" step="0.1" /></label>
          <label>进出水流量（m³/h）<input v-model="createForm.进出水流量" placeholder="如 进水 1200 / 出水 900" /></label>
        </div>
        <p class="form-hint">按当前水位折算蓄水量：<strong>{{ createPreview }} m³</strong></p>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 详情面板：与列表同源，读的是同一份投影 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal modal-wide">
        <h3>池体 {{ detail.池体编号 }} 调蓄详情</h3>
        <p class="modal-hint">归属班组：<strong>{{ detail.运行班组 }}</strong> · 状态：{{ detail.status }} · 列表页与本面板读数一致。</p>

        <div class="detail-grid">
          <div><span>有效容积</span><strong>{{ detail.有效容积 }} m³</strong></div>
          <div><span>水位上限</span><strong>{{ detail.水位上限 }} m</strong></div>
          <div><span>本班登记下限</span><strong>{{ detail.水位下限 }} m</strong></div>
          <div>
            <span>调度下发下限</span>
            <strong>{{ detail.调度下限 === null ? '未下发' : `${detail.调度下限} m` }}</strong>
          </div>
          <div>
            <span>适用下限（生效）</span>
            <strong>{{ detail.适用下限 }} m（{{ detail.下限来源 }}）</strong>
          </div>
          <div><span>当前水位</span><strong>{{ detail.当前水位 }} m</strong></div>
          <div><span>蓄水量（随水位联动）</span><strong>{{ detail.蓄水量 }} m³</strong></div>
          <div><span>进出水流量</span><strong>{{ detail.进出水流量 }}</strong></div>
        </div>

        <div v-if="detail.调度下限 !== null && detail.调度下限 !== detail.水位下限" class="conflict-box">
          水位下限打架：本班登记 {{ detail.水位下限 }}m，调度单下发 {{ detail.调度下限 }}m —— 以调度下发的 {{ detail.调度下限 }}m 为准。
        </div>

        <div v-if="detail.status === '已满池'" class="lock-box">
          已满池记录已锁死，有效容积、当前水位与进出水流量本班也动不了。
        </div>
        <div v-else-if="!canEdit" class="lock-box warn">
          该池归{{ detail.运行班组 }}经手，当前 {{ actor.crew }} 递上来的改动按越权退回。
        </div>

        <fieldset class="adjust-box" :disabled="!canEdit || detail.status === '已满池'">
          <legend>本班经手调整（{{ actor.crew }}）</legend>
          <div class="form-grid">
            <label>当前水位（m）<input v-model="adjustForm.当前水位" type="number" step="0.1" /></label>
            <label>有效容积（m³）<input v-model="adjustForm.有效容积" type="number" min="0" /></label>
            <label>进出水流量（m³/h）<input v-model="adjustForm.进出水流量" /></label>
          </div>
          <p class="form-hint">调整后蓄水量：<strong>{{ adjustPreview }} m³</strong>（不得低于适用下限 {{ detail.适用下限 }}m）</p>
          <p v-if="adjustError" class="error-text">{{ adjustError }}</p>
          <button class="btn primary" type="button" @click="submitAdjust">提交本班改动</button>
        </fieldset>

        <h4 class="audit-title">经手记录</h4>
        <table class="data-table audit-table">
          <thead>
            <tr><th>时间</th><th>动作</th><th>经手班组</th><th>经手人</th><th>结果</th><th>卡在哪 / 详情</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in audits" :key="item.id">
              <td>{{ item.time }}</td>
              <td>{{ item.动作 }}</td>
              <td>{{ item.经手班组 }}</td>
              <td>{{ item.经手人 }}</td>
              <td :class="item.结果 === '退回' ? 'result-reject' : 'result-pass'">{{ item.结果 }}</td>
              <td>{{ item.卡在哪 || item.详情 }}</td>
            </tr>
            <tr v-if="!audits.length">
              <td colspan="6" class="empty-state">暂无经手记录</td>
            </tr>
          </tbody>
        </table>

        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  adjustClearwell,
  changeClearwellStatus,
  downloadEntries,
  getClearwellDetail,
  listClearwellAudits,
  listClearwellRows,
  moduleMeta,
  registerClearwell,
  storageFor,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { Actor, ClearwellAudit, ClearwellViewRow } from '@/data/types'

const meta = moduleMeta('clearwell')
const columns = ["池体编号", "有效容积", "当前水位", "蓄水量", "适用下限", "进出水流量", "运行班组", "记录时间"]
const actions = ["提交蓄水", "确认满池", "上报预警"]
const statuses = ["待蓄水", "蓄水中", "已满池", "低水位预警"]

const session = useSessionStore()
const actor = computed<Actor>(() => ({ crew: session.crew, operator: session.operator }))

const rows = ref<ClearwellViewRow[]>([])
const total = ref(0)
const notice = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '蓄水中池体', value: rows.value.filter((r) => r.status === '蓄水中').length },
  { label: '已满池池体（锁死）', value: rows.value.filter((r) => r.status === '已满池').length },
  { label: '低水位预警次数', value: rows.value.filter((r) => r.status === '低水位预警').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  notice.value = ''
  rows.value = listClearwellRows(filters.value)
  total.value = rows.value.length
  if (detail.value) {
    refreshDetail(detail.value.id)
  }
}

// 登记
const createOpen = ref(false)
const createError = ref('')
const createForm = ref({
  池体编号: '',
  有效容积: '',
  水位上限: '',
  水位下限: '',
  当前水位: '',
  进出水流量: '',
})

const createPreview = computed(() => {
  const v = Number(createForm.value.有效容积)
  const level = Number(createForm.value.当前水位)
  const max = Number(createForm.value.水位上限)
  return Number.isFinite(v) && Number.isFinite(level) && Number.isFinite(max) && max > 0
    ? storageFor(v, level, max)
    : 0
})

function openCreate() {
  createError.value = ''
  createForm.value = {
    池体编号: '',
    有效容积: '',
    水位上限: '',
    水位下限: '',
    当前水位: '',
    进出水流量: '',
  }
  createOpen.value = true
}

function submitCreate() {
  createError.value = ''
  const result = registerClearwell(createForm.value, actor.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  notice.value = result.message
  reload()
}

// 详情 + 本班调整（越权班组也能打开面板查看，只是一提交就被退回并留痕）
const detail = ref<ClearwellViewRow | null>(null)
const audits = ref<ClearwellAudit[]>([])
const adjustError = ref('')
const adjustForm = ref({ 当前水位: '', 有效容积: '', 进出水流量: '' })

const canEdit = computed(() => detail.value?.运行班组 === actor.value.crew)

const adjustPreview = computed(() => {
  if (!detail.value) {
    return 0
  }
  const v = adjustForm.value.有效容积 !== '' ? Number(adjustForm.value.有效容积) : detail.value.有效容积
  const level = adjustForm.value.当前水位 !== '' ? Number(adjustForm.value.当前水位) : detail.value.当前水位
  return Number.isFinite(v) && Number.isFinite(level)
    ? storageFor(v, level, detail.value.水位上限)
    : detail.value.蓄水量
})

function refreshDetail(id: number) {
  const fresh = getClearwellDetail(id)
  if (fresh) {
    detail.value = fresh
    audits.value = listClearwellAudits(fresh.池体编号)
  }
}

function openDetail(row: ClearwellViewRow) {
  notice.value = ''
  detail.value = row
  audits.value = listClearwellAudits(row.池体编号)
  adjustError.value = ''
  adjustForm.value = {
    当前水位: String(row.当前水位),
    有效容积: String(row.有效容积),
    进出水流量: row.进出水流量,
  }
}

function closeDetail() {
  detail.value = null
  audits.value = []
}

function submitAdjust() {
  if (!detail.value) {
    return
  }
  adjustError.value = ''
  const changes: Parameters<typeof adjustClearwell>[1] = {}
  if (adjustForm.value.当前水位 !== '' && Number(adjustForm.value.当前水位) !== detail.value.当前水位) {
    changes.当前水位 = adjustForm.value.当前水位
  }
  if (adjustForm.value.有效容积 !== '' && Number(adjustForm.value.有效容积) !== detail.value.有效容积) {
    changes.有效容积 = adjustForm.value.有效容积
  }
  if (adjustForm.value.进出水流量.trim() !== detail.value.进出水流量) {
    changes.进出水流量 = adjustForm.value.进出水流量
  }
  if (Object.keys(changes).length === 0) {
    adjustError.value = '没有改动，无需提交'
    return
  }
  const result = adjustClearwell(detail.value.id, changes, actor.value)
  if (!result.ok) {
    adjustError.value = result.message
  } else {
    adjustError.value = ''
  }
  // 通过或退回都刷新：通过看新读数，退回看新增的经手记录。
  refreshDetail(detail.value.id)
  reload()
  if (result.ok) {
    notice.value = result.message
  }
}

function changeStatus(action: string, row: ClearwellViewRow) {
  notice.value = ''
  const result = changeClearwellStatus(Number(row.id), action, actor.value)
  if (!result.ok) {
    notice.value = result.message
  }
  reload()
}

onMounted(reload)
</script>
