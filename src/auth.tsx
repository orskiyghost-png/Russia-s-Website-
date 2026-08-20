import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User as SupabaseUser } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { AuthUser } from './types'

type AuthResult = { error: string | null; needsVerification?: boolean }
type VerifyResult = { error: string | null }
type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  configured: boolean
  login: (email: string) => Promise<AuthResult>
  register: (name: string, email: string) => Promise<AuthResult>
  signInWithOAuth: (provider: 'google' | 'apple') => Promise<AuthResult>
  verifyOtp: (email: string, token: string) => Promise<VerifyResult>
  updateProfile: (updates: Partial<Pick<AuthUser, 'name' | 'city' | 'notifications'>>) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
type ProfileRow = { name: string; city: string; notifications: boolean; created_at: string; avatar_url?: string | null }

async function hydrateUser(sessionUser: SupabaseUser): Promise<AuthUser> {
  const { data } = await supabase.from('profiles').select('name, city, notifications, created_at, avatar_url').eq('id', sessionUser.id).maybeSingle()
  const profile = data as ProfileRow | null
  return { id: sessionUser.id, email: sessionUser.email ?? '', name: profile?.name ?? sessionUser.user_metadata.name ?? sessionUser.email?.split('@')[0] ?? 'Гость', city: profile?.city ?? 'Орск', notifications: profile?.notifications ?? true, avatarUrl: profile?.avatar_url ?? sessionUser.user_metadata.avatar_url ?? null, createdAt: profile ? new Date(profile.created_at).getTime() : Date.now() }
}

function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    let mounted = true
    const applySession = async (session: Session | null) => {
      if (!session) { if (mounted) setUser(null); return }
      const nextUser = await hydrateUser(session.user)
      if (mounted) setUser(nextUser)
    }
    void supabase.auth.getSession().then(({ data }) => applySession(data.session)).finally(() => { if (mounted) setLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => { void applySession(session) }, 0) })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user, loading, configured: isSupabaseConfigured,
    login: async (email) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment' }
      if (!validEmail(email)) return { error: 'Проверьте формат email' }
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
      return error ? { error: translateAuthError(error.message) } : { error: null, needsVerification: true }
    },
    register: async (name, email) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment' }
      if (name.trim().length < 2) return { error: 'Введите имя от 2 символов' }
      if (!validEmail(email)) return { error: 'Проверьте формат email' }
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, data: { name: name.trim() } } })
      return error ? { error: translateAuthError(error.message) } : { error: null, needsVerification: true }
    },
    signInWithOAuth: async (provider) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте Supabase environment variables' }
      const redirectTo = `${window.location.origin}${window.location.pathname}`
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
      return error ? { error: translateAuthError(error.message) } : { error: null }
    },
    verifyOtp: async (email, token) => {
      if (!isSupabaseConfigured) return { error: 'Supabase не настроен' }
      if (!validEmail(email)) return { error: 'Проверьте email' }
      if (!/^\d{6}$/.test(token.trim())) return { error: 'Введите 6-значный код из письма' }
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' })
      return error ? { error: translateAuthError(error.message) } : { error: null }
    },
    updateProfile: async (updates) => {
      if (!user) return 'Сначала войдите в аккаунт'
      const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
      if (error) return translateAuthError(error.message)
      setUser({ ...user, ...updates })
      return null
    },
    logout: async () => { await supabase.auth.signOut(); setUser(null) },
  }), [loading, user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function translateAuthError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('error sending magic link email') || normalized.includes('error sending email')) return 'Не удалось отправить письмо. Проверьте SMTP в Supabase и попробуйте ещё раз через минуту.'
  if (normalized.includes('invalid') && normalized.includes('token')) return 'Код истёк или введён неверно'
  if (normalized.includes('expired')) return 'Срок действия кода истёк. Запросите новый код'
  if (normalized.includes('email not confirmed')) return 'Подтвердите email кодом из письма'
  if (normalized.includes('email rate limit') || normalized.includes('rate limit')) return 'Слишком много попыток. Попробуйте позже'
  if (normalized.includes('user not found')) return 'Пользователь не найден. Выберите регистрацию'
  if (normalized.includes('signups not allowed')) return 'Регистрация отключена в настройках Supabase'
  return message
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
