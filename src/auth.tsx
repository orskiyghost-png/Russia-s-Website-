import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User as SupabaseUser } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { AuthUser } from './types'

type AuthResult = { error: string | null }
type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  configured: boolean
  login: (email: string, password: string, captchaToken: string) => Promise<AuthResult>
  register: (name: string, email: string, password: string, captchaToken: string) => Promise<AuthResult>
  updateProfile: (updates: Partial<Pick<AuthUser, 'name' | 'city' | 'bio' | 'neighborhood' | 'notifications' | 'avatarUrl'>>) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
type ProfileRow = { name: string; city: string; bio?: string | null; neighborhood?: string | null; role?: 'user' | 'admin' | null; notifications: boolean; created_at: string; avatar_url?: string | null }
type ExtendedSupabaseUser = SupabaseUser & { is_anonymous?: boolean }

function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) }
function isAnonymousUser(sessionUser: SupabaseUser) { const user = sessionUser as ExtendedSupabaseUser; return user.is_anonymous === true || sessionUser.app_metadata?.is_anonymous === true || sessionUser.app_metadata?.provider === 'anonymous' }
function authProviderFor(sessionUser: SupabaseUser): AuthUser['authProvider'] { if (isAnonymousUser(sessionUser)) return 'anonymous'; return sessionUser.app_metadata?.provider === 'email' ? 'email' : 'unknown' }

async function hydrateUser(sessionUser: SupabaseUser): Promise<AuthUser> {
  const anonymous = isAnonymousUser(sessionUser)
  let profile: ProfileRow | null = null
  if (!anonymous) {
    const extended = await supabase.from('profiles').select('name, city, bio, neighborhood, role, notifications, created_at, avatar_url').eq('id', sessionUser.id).maybeSingle()
    if (!extended.error) profile = extended.data as ProfileRow | null
    else {
      const legacy = await supabase.from('profiles').select('name, city, notifications, created_at, avatar_url').eq('id', sessionUser.id).maybeSingle()
      profile = legacy.data as ProfileRow | null
    }
  }
  const fallbackName = anonymous ? 'Гость' : sessionUser.user_metadata.name ?? sessionUser.email?.split('@')[0] ?? 'Пользователь'
  return { id: sessionUser.id, email: sessionUser.email ?? '', name: profile?.name ?? fallbackName, city: profile?.city ?? 'Орск', bio: profile?.bio ?? null, neighborhood: profile?.neighborhood ?? null, role: profile?.role === 'admin' ? 'admin' : 'user', notifications: profile?.notifications ?? true, avatarUrl: profile?.avatar_url ?? sessionUser.user_metadata.avatar_url ?? null, createdAt: profile ? new Date(profile.created_at).getTime() : Date.now(), isAnonymous: anonymous, authProvider: authProviderFor(sessionUser) }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    let mounted = true
    const applySession = async (session: Session | null) => {
      if (!session) { if (mounted) setUser(null); return }
      // Проверяем, что сессия действительно жива (токен не протух и не отозван).
      // Протухшая сессия выглядит «залогиненной», но все RPC падают — лучше сразу разлогинить.
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        const message = String(userError?.message ?? '').toLowerCase()
        const networkIssue = message.includes('fetch') || message.includes('network') || message.includes('timeout') || message.includes('offline')
        if (networkIssue) {
          // Сеть недоступна — не выкидываем пользователя, показываем последние данные сессии.
          const nextUser = await hydrateUser(session.user)
          if (mounted) setUser(nextUser)
          return
        }
        await supabase.auth.signOut().catch(() => undefined)
        if (mounted) setUser(null)
        return
      }
      const nextUser = await hydrateUser(userData.user)
      if (mounted) setUser(nextUser)
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => { void applySession(session) }, 0) })
    void supabase.auth.getSession().then(({ data }) => applySession(data.session)).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    configured: isSupabaseConfigured,
    login: async (email, password, captchaToken) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте Supabase environment variables' }
      if (!validEmail(email)) return { error: 'Проверьте формат email' }
      if (password.length < 6) return { error: 'Пароль должен содержать минимум 6 символов' }
      // Капча не блокирует отправку: если виджет не выдал токен, сервер сам решает
      // (Supabase отклоняет запрос только когда включён Bot and Abuse Protection).
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: captchaToken ? { captchaToken } : undefined })
      return error ? { error: translateAuthError(error.message) } : { error: null }
    },
    register: async (name, email, password, captchaToken) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте Supabase environment variables' }
      if (name.trim().length < 2) return { error: 'Введите имя от 2 символов' }
      if (!validEmail(email)) return { error: 'Проверьте формат email' }
      if (password.length < 6) return { error: 'Пароль должен содержать минимум 6 символов' }
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { ...(captchaToken ? { captchaToken } : {}), data: { name: name.trim() } } })
      if (error) return { error: translateAuthError(error.message) }
      if (!data.session) return { error: 'Аккаунт создан, но Supabase всё ещё требует подтверждение email. Отключите Confirm email в Auth Settings.' }
      return { error: null }
    },
    updateProfile: async (updates) => {
      if (!user || user.isAnonymous) return 'Постоянный аккаунт нужен для сохранения профиля'
      const payload: Record<string, unknown> = {}
      if (updates.name !== undefined) payload.name = updates.name
      if (updates.city !== undefined) payload.city = updates.city
      if (updates.bio !== undefined) payload.bio = updates.bio
      if (updates.neighborhood !== undefined) payload.neighborhood = updates.neighborhood
      if (updates.notifications !== undefined) payload.notifications = updates.notifications
      if (updates.avatarUrl !== undefined) payload.avatar_url = updates.avatarUrl
      const { error } = await supabase.from('profiles').update(payload).eq('id', user.id)
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
  if (normalized.includes('invalid login credentials') || normalized.includes('invalid password') || normalized.includes('user not found')) return 'Неверный email или пароль'
  if (normalized.includes('already registered') || normalized.includes('user already exists')) return 'Аккаунт с этим email уже существует. Войдите во вкладке «Вход».'
  if (normalized.includes('password')) return 'Пароль должен содержать минимум 6 символов'
  if (normalized.includes('captcha')) return 'Сервер отклонил капчу. В Supabase (Authentication → Bot and Abuse Protection) должен быть выбран провайдер hCaptcha со вставленным Secret key из hCaptcha (не Site key).'
  if (normalized.includes('signup') && normalized.includes('disabled')) return 'Регистрация отключена в настройках Supabase'
  if (normalized.includes('email')) return 'Проверьте email и повторите попытку'
  if (normalized.includes('anonymous')) return 'Гостевой режим временно недоступен'
  return message
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value }
