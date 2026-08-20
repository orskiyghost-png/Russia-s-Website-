import { AlertTriangle, Bike, HandHeart, Layers3, Sparkles, Zap, Construction, Droplets, PartyPopper, Siren } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { IconComponent, RadarEvent, EventKind, Layer } from './types'
import { isSupabaseConfigured, supabase } from './lib/supabase'

export const DEFAULT_CENTER: [number, number] = [51.2049, 58.5668]

export const layerConfig: Array<{ id: Layer; label: string; icon: IconComponent; color: string }> = [
  { id: 'all', label: 'Все события', icon: Layers3, color: 'lime' },
  { id: 'roads', label: 'ДТП и Дороги', icon: Construction, color: 'amber' },
  { id: 'utilities', label: 'ЖКХ и Отключения', icon: Droplets, color: 'blue' },
  { id: 'social', label: 'Погулять и Встречи', icon: PartyPopper, color: 'pink' },
  { id: 'incidents', label: 'Происшествия', icon: Siren, color: 'violet' },
]

export const kindConfig: Record<EventKind, { label: string; color: string; icon: IconComponent }> = {
  city: { label: 'Город', color: 'amber', icon: AlertTriangle },
  vibe: { label: 'Вайб', color: 'pink', icon: Sparkles },
  street: { label: 'Стрит', color: 'violet', icon: Bike },
  help: { label: 'Бартер', color: 'blue', icon: HandHeart },
}

export const seedEvents: RadarEvent[] = [
  { id: 'orsk-water', kind: 'city', category: 'ЖКХ и Отключения', title: 'Воду вернут к 18:00', description: 'Коммунальная бригада работает на линии. Питьевая вода доступна у соседнего дома.', location: 'проспект Ленина', lat: 51.2038, lng: 58.5662, createdAt: Date.now() - 12 * 60_000, userName: 'Городской штаб', reactions: 12, comments: 3 },
  { id: 'orsk-vibe', kind: 'vibe', category: 'Погулять и Встречи', title: 'Тихий вечер у реки', description: 'Спокойный маршрут для прогулки: мягкий свет, открытые веранды и музыка во дворах.', location: 'Набережная Урала', lat: 51.2152, lng: 58.5793, createdAt: Date.now() - 8 * 60_000, userName: 'orsk.wav', reactions: 24, comments: 5 },
  { id: 'orsk-street', kind: 'street', category: 'Погулять и Встречи', title: 'Новый спот для роликов', description: 'Ровная площадка с хорошим светом после 19:00. Подходит для новичков.', location: 'Парк Строителей', lat: 51.2058, lng: 58.5584, createdAt: Date.now() - 34 * 60_000, userName: 'anton_ollie', reactions: 18, comments: 4 },
  { id: 'orsk-help', kind: 'help', category: 'Происшествия', title: 'Отдам домашнюю выпечку', description: 'Свежий хлеб и пироги, можно забрать сегодня до 20:00.', location: '2-й микрорайон', lat: 51.1887, lng: 58.5611, createdAt: Date.now() - 60 * 60_000, userName: 'sosedka_ira', reactions: 9, comments: 2 },
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
  avatar_url?: string | null
  reactions: number
  comments: number
}

function fromRow(row: EventRow): RadarEvent {
  return { id: row.id, kind: row.kind, category: row.category, title: row.title, description: row.description, location: `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`, lat: row.lat, lng: row.lng, createdAt: new Date(row.created_at).getTime(), userName: row.user_name, avatarUrl: row.avatar_url ?? null, reactions: row.reactions, comments: row.comments }
}

export async function fetchEvents(): Promise<{ events: RadarEvent[]; configured: boolean }> {
  if (!isSupabaseConfigured) return { events: seedEvents, configured: false }
  const primary = await supabase.from('events').select('id, kind, category, title, description, lat, lng, created_at, user_name, avatar_url, reactions, comments').order('created_at', { ascending: false }).limit(100)
  if (!primary.error) return { events: (primary.data as EventRow[]).map(fromRow), configured: true }
  if (!primary.error.message.toLowerCase().includes('avatar_url')) throw primary.error
  const legacy = await supabase.from('events').select('id, kind, category, title, description, lat, lng, created_at, user_name, reactions, comments').order('created_at', { ascending: false }).limit(100)
  if (legacy.error) throw legacy.error
  return { events: (legacy.data as EventRow[]).map(fromRow), configured: true }
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

export function eventLayer(category: string): Exclude<Layer, 'all'> {
  const value = category.toLowerCase()
  if (/(дтп|дорог|перекры|ремонт|авар)/.test(value)) return 'roads'
  if (/(жкх|коммун|вод|свет|отопл|отключ)/.test(value)) return 'utilities'
  if (/(погуля|встреч|событ|меропр|мест|вайб|стрит|бартер|помощ)/.test(value)) return 'social'
  return 'incidents'
}

export function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  return `${hours} ч назад`
}


export async function updateEventStats(id: string, changes: { reactions?: number; comments?: number }) {
  if (!isSupabaseConfigured || id.startsWith('orsk-')) return
  const { error } = await supabase.from('events').update(changes).eq('id', id)
  if (error) throw error
}
