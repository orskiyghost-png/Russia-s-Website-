import { AlertTriangle, Bike, HandHeart, Layers3, Sparkles, Zap } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { IconComponent, RadarEvent, EventKind, Layer } from './types'
import { isSupabaseConfigured, supabase } from './lib/supabase'

export const DEFAULT_CENTER: [number, number] = [55.7558, 37.6173]

export const layerConfig: Array<{ id: Layer; label: string; icon: IconComponent; color: string }> = [
  { id: 'all', label: 'Все события', icon: Layers3, color: 'lime' },
  { id: 'city', label: 'Город', icon: Zap, color: 'amber' },
  { id: 'vibe', label: 'Вайб', icon: Sparkles, color: 'pink' },
  { id: 'street', label: 'Стрит', icon: Bike, color: 'violet' },
  { id: 'help', label: 'Бартер', icon: HandHeart, color: 'blue' },
]

export const kindConfig: Record<EventKind, { label: string; color: string; icon: IconComponent }> = {
  city: { label: 'Город', color: 'amber', icon: AlertTriangle },
  vibe: { label: 'Вайб', color: 'pink', icon: Sparkles },
  street: { label: 'Стрит', color: 'violet', icon: Bike },
  help: { label: 'Бартер', color: 'blue', icon: HandHeart },
}

export const seedEvents: RadarEvent[] = [
  { id: 'moscow-water', kind: 'city', category: 'Коммунальное', title: 'Нет воды до 18:00', description: 'Аварийные работы на магистрали. Ближайший кран с питьевой водой — в 480 м.', location: 'ул. Большая Никитская, 22', lat: 55.7577, lng: 37.6012, createdAt: Date.now() - 12 * 60_000, userName: 'Городской штаб', reactions: 42, comments: 8 },
  { id: 'patriarch-vibe', kind: 'vibe', category: 'Вайб', title: 'Тихий двор, идеальный закат', description: 'Люди сидят на лавочках, играет винил из открытого окна. Спокойно и очень красиво.', location: 'Патриаршие пруды', lat: 55.7654, lng: 37.5944, createdAt: Date.now() - 8 * 60_000, userName: 'masha.wav', reactions: 76, comments: 14 },
  { id: 'hermitage-skate', kind: 'street', category: 'Стрит-культура', title: 'Новый спот для скейта', description: 'Свежий спот с плоскими гранями и мягким светом после 19:00. Уровень: любой.', location: 'Сад Эрмитаж', lat: 55.7704, lng: 37.6162, createdAt: Date.now() - 34 * 60_000, userName: 'anton_ollie', reactions: 31, comments: 5 },
  { id: 'bread-share', kind: 'help', category: 'Соседская помощь', title: 'Отдам домашний хлеб', description: 'Заквасочный хлеб, испечён сегодня утром. Осталось 2 буханки, забрать до 20:00.', location: 'Климентовский пер., 8', lat: 55.7418, lng: 37.6278, createdAt: Date.now() - 60 * 60_000, userName: 'sosedka_ira', reactions: 18, comments: 3 },
  { id: 'sadovoe-traffic', kind: 'city', category: 'Дорожная обстановка', title: 'Движение в одну полосу', description: 'Из-за небольшого ДТП правая полоса перекрыта. Ожидаем восстановление движения.', location: 'Садовое кольцо, 41', lat: 55.7658, lng: 37.6373, createdAt: Date.now() - 26 * 60_000, userName: 'PULSE AI', reactions: 23, comments: 11 },
  { id: 'popup-sale', kind: 'vibe', category: 'Событие', title: 'Pop-up распродажа во дворе', description: 'Локальные бренды, винил и кофе. Работает сегодня до 22:00.', location: 'Чистые пруды', lat: 55.7648, lng: 37.6404, createdAt: Date.now() - 2 * 60 * 60_000, userName: 'citycurator', reactions: 54, comments: 19 },
]

type EventRow = {
  id: string
  kind: EventKind
  category: string
  title: string
  description: string
  lat: number
  lng: number
  created_at: string
  user_name: string
  reactions: number
  comments: number
}

function fromRow(row: EventRow): RadarEvent {
  return { id: row.id, kind: row.kind, category: row.category, title: row.title, description: row.description, location: `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`, lat: row.lat, lng: row.lng, createdAt: new Date(row.created_at).getTime(), userName: row.user_name, reactions: row.reactions, comments: row.comments }
}

export async function fetchEvents(): Promise<{ events: RadarEvent[]; configured: boolean }> {
  if (!isSupabaseConfigured) return { events: seedEvents, configured: false }
  const { data, error } = await supabase.from('events').select('id, kind, category, title, description, lat, lng, created_at, user_name, reactions, comments').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return { events: (data as EventRow[]).map(fromRow), configured: true }
}

export function subscribeToEvents(onChange: () => void): () => void {
  if (!isSupabaseConfigured) return () => undefined
  const channel: RealtimeChannel = supabase.channel('pulse-events').on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange).subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export async function createEvent(payload: { kind: EventKind; category: string; title: string; description: string; lat: number; lng: number }): Promise<RadarEvent> {
  if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED')
  const { data, error } = await supabase.rpc('create_event', { p_kind: payload.kind, p_category: payload.category, p_title: payload.title, p_description: payload.description, p_lat: payload.lat, p_lng: payload.lng })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return fromRow(row as EventRow)
}

export function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  return `${hours} ч назад`
}
