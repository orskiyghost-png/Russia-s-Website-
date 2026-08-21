import { AlertTriangle, Bike, HandHeart, Layers3, Sparkles, Construction, Droplets, PartyPopper, Siren } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { IconComponent, RadarEvent, EventComment, EventKind, Layer } from './types'
import { isSupabaseConfigured, supabase } from './lib/supabase'

export const DEFAULT_CENTER: [number, number] = [51.2049, 58.5668]

/** Stable avatar color: the same display name always gets the same fallback color. */
export function avatarColor(name: string) {
  let hash = 0
  for (const character of name.trim().toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return `hsl(${Math.abs(hash) % 360} 68% 58%)`
}

export const layerConfig: Array<{ id: Layer; label: string; icon: IconComponent; color: string }> = [
  { id: 'all', label: 'Все сигналы', icon: Layers3, color: 'lime' },
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
  { id: 'orsk-water', kind: 'city', category: 'ЖКХ и Отключения', title: 'Воду вернут к 18:00', description: 'Коммунальная бригада работает на линии. Питьевая вода доступна у соседнего дома.', location: 'проспект Ленина', lat: 51.2038, lng: 58.5662, createdAt: Date.now() - 12 * 60_000, userName: 'Городской штаб', reactions: 12, comments: 3, likedByMe: false, commentsList: [] },
  { id: 'orsk-vibe', kind: 'vibe', category: 'Погулять и Встречи', title: 'Тихий вечер у реки', description: 'Спокойный маршрут для прогулки: мягкий свет, открытые веранды и музыка во дворах.', location: 'Набережная Урала', lat: 51.2152, lng: 58.5793, createdAt: Date.now() - 8 * 60_000, userName: 'orsk.wav', reactions: 24, comments: 5, likedByMe: false, commentsList: [] },
  { id: 'orsk-street', kind: 'street', category: 'Погулять и Встречи', title: 'Новый спот для роликов', description: 'Ровная площадка с хорошим светом после 19:00. Подходит для новичков.', location: 'Парк Строителей', lat: 51.2058, lng: 58.5584, createdAt: Date.now() - 34 * 60_000, userName: 'anton_ollie', reactions: 18, comments: 4, likedByMe: false, commentsList: [] },
  { id: 'orsk-help', kind: 'help', category: 'Происшествия', title: 'Отдам домашнюю выпечку', description: 'Свежий хлеб и пироги, можно забрать сегодня до 20:00.', location: '2-й микрорайон', lat: 51.1887, lng: 58.5611, createdAt: Date.now() - 60 * 60_000, userName: 'sosedka_ira', reactions: 9, comments: 2, likedByMe: false, commentsList: [] },
]

type EventRow = {
  id: string
  kind: EventKind
  category: string
  title: string
  description: string
  lat: number
  lng: number
  address?: string | null
  moderation_status?: 'published' | 'hidden' | 'removed' | null
  created_at: string
  user_id?: string | null
  user_name: string
  avatar_url?: string | null
  reactions: number
  comments: number
}

type CommentRow = {
  id: string
  user_name: string
  avatar_url?: string | null
  body: string
  created_at: string
}

function fromRow(row: EventRow): RadarEvent {
  const address = row.address?.trim() || null
  return { id: row.id, kind: row.kind, category: row.category, title: row.title, description: row.description, location: address || `${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}`, address, lat: row.lat, lng: row.lng, createdAt: new Date(row.created_at).getTime(), userName: row.user_name, userId: row.user_id ?? null, avatarUrl: row.avatar_url ?? null, reactions: row.reactions, comments: row.comments, likedByMe: false, commentsList: [] }
}

async function attachLikedState(events: RadarEvent[]) {
  if (!isSupabaseConfigured || events.length === 0) return events
  const { data: authData } = await supabase.auth.getUser()
  const user = authData.user
  if (!user || user.app_metadata?.provider === 'anonymous' || user.app_metadata?.is_anonymous === true) return events
  const ids = events.filter((event) => !event.id.startsWith('orsk-')).map((event) => event.id)
  if (ids.length === 0) return events
  const result = await supabase.from('event_reactions').select('event_id').eq('user_id', user.id).in('event_id', ids)
  if (result.error) return events
  const liked = new Set((result.data ?? []).map((row) => String(row.event_id)))
  return events.map((event) => ({ ...event, likedByMe: liked.has(event.id) }))
}

async function normalizeEvents(rows: EventRow[]) {
  return attachLikedState(rows.map(fromRow))
}

export async function fetchEvents(): Promise<{ events: RadarEvent[]; configured: boolean }> {
  if (!isSupabaseConfigured) return { events: seedEvents, configured: false }
  const primary = await supabase.from('events').select('id, kind, category, title, description, lat, lng, address, moderation_status, created_at, user_id, user_name, avatar_url, reactions, comments').eq('moderation_status', 'published').order('created_at', { ascending: false }).limit(100)
  if (!primary.error) return { events: await normalizeEvents(primary.data as EventRow[]), configured: true }
  const primaryError = primary.error.message.toLowerCase()
  if (!primaryError.includes('avatar_url') && !primaryError.includes('address') && !primaryError.includes('moderation_status')) throw primary.error
  const legacy = await supabase.from('events').select('id, kind, category, title, description, lat, lng, address, created_at, user_name, reactions, comments').order('created_at', { ascending: false }).limit(100)
  if (!legacy.error) return { events: await normalizeEvents(legacy.data as EventRow[]), configured: true }
  if (!legacy.error.message.toLowerCase().includes('address')) throw legacy.error
  const oldest = await supabase.from('events').select('id, kind, category, title, description, lat, lng, created_at, user_name, reactions, comments').order('created_at', { ascending: false }).limit(100)
  if (oldest.error) throw oldest.error
  return { events: await normalizeEvents(oldest.data as EventRow[]), configured: true }
}

export function subscribeToEvents(onChange: () => void): () => void {
  if (!isSupabaseConfigured) return () => undefined
  const channel: RealtimeChannel = supabase.channel('pulse-events').on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, onChange).subscribe()
  return () => { void supabase.removeChannel(channel) }
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ru&lat=${lat}&lon=${lng}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  const result = await response.json() as { display_name?: string }
  return result.display_name?.split(',').slice(0, 3).join(', ').trim() || null
}

export async function createEvent(payload: { kind: EventKind; category: string; title: string; description: string; lat: number; lng: number; address?: string | null }): Promise<RadarEvent> {
  if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED')
  const { data, error } = await supabase.rpc('create_event', { p_kind: payload.kind, p_category: payload.category, p_title: payload.title, p_description: payload.description, p_lat: payload.lat, p_lng: payload.lng })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('EVENT_NOT_CREATED')
  const created = fromRow(row as EventRow)
  const address = payload.address?.trim() || null
  if (address && created.id) {
    const addressResult = await supabase.rpc('set_event_address', { p_event_id: created.id, p_address: address })
    if (!addressResult.error) return { ...created, address, location: address }
  }
  return created
}

export async function setEventAddress(eventId: string, address: string): Promise<void> {
  if (!isSupabaseConfigured || !address.trim()) return
  const { error } = await supabase.rpc('set_event_address', { p_event_id: eventId, p_address: address.trim() })
  if (error) throw error
}

export type EventReport = { id: string; eventId: string; reason: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: number }

export type DirectMessage = { id: string; senderId: string; recipientId: string; body: string; createdAt: number }

export async function fetchDirectMessages(otherUserId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase.rpc('list_direct_messages', { p_other_user_id: otherUserId })
  if (error) throw error
  return (data ?? []).map((row: { id: string; sender_id: string; recipient_id: string; body: string; created_at: string }) => ({ id: row.id, senderId: row.sender_id, recipientId: row.recipient_id, body: row.body, createdAt: new Date(row.created_at).getTime() }))
}

export async function sendDirectMessage(recipientId: string, body: string): Promise<DirectMessage> {
  const { data, error } = await supabase.rpc('send_direct_message', { p_recipient_id: recipientId, p_body: body.trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { id: String(row.id), senderId: String(row.sender_id), recipientId: String(row.recipient_id), body: String(row.body), createdAt: new Date(row.created_at).getTime() }
}

export async function reportEvent(eventId: string, reason: string): Promise<void> {
  if (!isSupabaseConfigured || eventId.startsWith('orsk-')) throw new Error('REPORT_NOT_AVAILABLE')
  const { error } = await supabase.rpc('create_event_report', { p_event_id: eventId, p_reason: reason.trim() })
  if (error) throw error
}

export async function fetchOpenReports(): Promise<EventReport[]> {
  const { data, error } = await supabase.rpc('admin_list_open_reports')
  if (error) throw error
  return (data ?? []).map((row: { id: string; event_id: string; reason: string; status: EventReport['status']; created_at: string }) => ({ id: row.id, eventId: row.event_id, reason: row.reason, status: row.status, createdAt: new Date(row.created_at).getTime() }))
}

export async function setEventModerationStatus(eventId: string, status: 'published' | 'hidden' | 'removed'): Promise<void> {
  const { error } = await supabase.rpc('admin_set_event_status', { p_event_id: eventId, p_status: status })
  if (error) throw error
}

export async function toggleReaction(eventId: string): Promise<{ reactions: number; likedByMe: boolean }> {
  if (!isSupabaseConfigured || eventId.startsWith('orsk-')) throw new Error('REACTION_NOT_AVAILABLE')
  const { data, error } = await supabase.rpc('toggle_reaction', { p_event_id: eventId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { reactions: Number(row?.reactions ?? 0), likedByMe: Boolean(row?.liked_by_me) }
}

export async function fetchComments(eventId: string): Promise<EventComment[]> {
  if (!isSupabaseConfigured || eventId.startsWith('orsk-')) return []
  const { data, error } = await supabase.from('comments').select('id, user_name, avatar_url, body, created_at').eq('event_id', eventId).order('created_at', { ascending: true }).limit(50)
  if (error) throw error
  return (data as CommentRow[]).map((row) => ({ id: row.id, userName: row.user_name, avatarUrl: row.avatar_url ?? null, body: row.body, createdAt: new Date(row.created_at).getTime() }))
}

export async function addComment(eventId: string, body: string): Promise<{ comment: EventComment; comments: number }> {
  if (!isSupabaseConfigured || eventId.startsWith('orsk-')) throw new Error('COMMENT_NOT_AVAILABLE')
  const { data, error } = await supabase.rpc('add_comment', { p_event_id: eventId, p_body: body.trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    comments: Number(row?.comments_count ?? row?.comments ?? 0),
    comment: { id: String(row?.id), userName: String(row?.user_name ?? 'Пользователь'), avatarUrl: row?.avatar_url ?? null, body: String(row?.body ?? body), createdAt: new Date(row?.created_at ?? Date.now()).getTime() },
  }
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

export function apiErrorKind(error: unknown): 'auth' | 'admin' | 'rate-limit' | 'missing-rpc' | 'other' {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  if (message.includes('AUTH_REQUIRED') || message.includes('PERMANENT_ACCOUNT_REQUIRED')) return 'auth'
  if (message.includes('ADMIN_REQUIRED')) return 'admin'
  if (message.includes('RATE_LIMIT') || message.includes('COMMENT_RATE_LIMIT')) return 'rate-limit'
  if (lowered.includes('could not find the function') || (lowered.includes('function') && lowered.includes('does not exist')) || lowered.includes('schema cache')) return 'missing-rpc'
  return 'other'
}
