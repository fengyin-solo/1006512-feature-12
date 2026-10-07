import { nowStamp } from './clock'
import type { HandoverTodo } from './types'

// 值班交接待办：独立存在一个 localStorage 键里，清水池的归属判定回写、交接班页面读取办结都走这里。
const STORAGE_KEY = 'waterworks-ops:handover-todos'

function readTodos(): HandoverTodo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as HandoverTodo[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveTodos(todos: HandoverTodo[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }
}

export function listHandoverTodos(): HandoverTodo[] {
  // 新的待办排在前面，接班时先看最近发生的。
  return readTodos().slice().sort((a, b) => b.id - a.id)
}

export function appendHandoverTodo(content: string, source = '清水池调蓄'): HandoverTodo {
  const todos = readTodos()
  const todo: HandoverTodo = {
    id: todos.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    time: nowStamp(),
    source,
    content,
    done: false,
  }
  saveTodos([...todos, todo])
  return todo
}

export function completeHandoverTodo(id: number): void {
  const todos = readTodos().map((item) => (item.id === id ? { ...item, done: true } : item))
  saveTodos(todos)
}
