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
  verifyOtp: (email: string, token: string) => Promise<VerifyResult>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signInAnonymously: () => Promise<{ error: string | null }>
  updateProfile: (updates: Partial<Pick<AuthUser, 'name' | 'city' | 'notifications'>>) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
type ProfileRow = { name: string; city: string; notifications: boolean; created_at: string; avatar_url?: string | null }
type ExtendedSupabaseUser = SupabaseUser & { is_anonymous?: boolean }

function validEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) }

function appRedirectUrl() {
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString()
}

function isAnonymousUser(sessionUser: SupabaseUser) {
  const user = sessionUser as ExtendedSupabaseUser
  return user.is_anonymous === true || sessionUser.app_metadata?.is_anonymous === true || sessionUser.app_metadata?.provider === 'anonymous'
}

function authProviderFor(sessionUser: SupabaseUser): AuthUser['authProvider'] {
  if (isAnonymousUser(sessionUser)) return 'anonymous'
  const provider = sessionUser.app_metadata?.provider ?? sessionUser.identities?.[0]?.provider
  if (provider === 'google') return 'google'
  if (provider === 'email') return 'email'
  return 'unknown'
}

async function hydrateUser(sessionUser: SupabaseUser): Promise<AuthUser> {
  const anonymous = isAnonymousUser(sessionUser)
  const { data } = anonymous ? { data: null } : await supabase.from('profiles').select('name, city, notifications, created_at, avatar_url').eq('id', sessionUser.id).maybeSingle()
  const profile = data as ProfileRow | null
  const fallbackName = anonymous ? 'Гость' : sessionUser.user_metadata.name ?? sessionUser.email?.split('@')[0] ?? 'Гость'
  return {
    id: sessionUser.id,
    email: sessionUser.email ?? '',
    name: profile?.name ?? fallbackName,
    city: profile?.city ?? 'Орск',
    notifications: profile?.notifications ?? true,
    avatarUrl: profile?.avatar_url ?? sessionUser.user_metadata.avatar_url ?? null,
    createdAt: profile ? new Date(profile.created_at).getTime() : Date.now(),
    isAnonymous: anonymous,
    authProvider: authProviderFor(sessionUser),
  }
}

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

    const completeAuthCallback = async () => {
      const params = new URLSearchParams(window.location.search)
      const tokenHash = params.get('token_hash')
      if (tokenHash) {
        const { data } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
        if (data.session) await applySession(data.session)
        const basePath = new URL(import.meta.env.BASE_URL || '/', window.location.origin).pathname
        const cleanPath = window.location.pathname.startsWith(basePath) ? window.location.pathname : basePath
        window.history.replaceState({}, document.title, `${cleanPath}${window.location.hash}`)
      }
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => { void applySession(session) }, 0)
    })
    void completeAuthCallback()
      .then(() => supabase.auth.getSession())
      .then(({ data }) => applySession(data.session))
      .finally(() => { if (mounted) setLoading(false) })

    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    configured: isSupabaseConfigured,
    login: async (email) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment' }
      if (!validEmail(email)) return { error: 'Проверьте формат email' }

      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: appRedirectUrl() } })

      return error ? { error: translateAuthError(error.message) } : { error: null, needsVerification: true }
    },
    register: async (name, email) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment' }
      if (name.trim().length < 2) return { error: 'Введите имя от 2 символов' }
      if (!validEmail(email)) return { error: 'Проверьте формат email' }

      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: appRedirectUrl(), data: { name: name.trim() } } })

      return error ? { error: translateAuthError(error.message) } : { error: null, needsVerification: true }
    },
    verifyOtp: async (email, token) => {
      if (!isSupabaseConfigured) return { error: 'Supabase не настроен' }
      if (!validEmail(email)) return { error: 'Проверьте email' }
      if (!/^\d{6}$/.test(token.trim())) return { error: 'Введите 6-значный код из письма' }
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' })
      return error ? { error: translateAuthError(error.message) } : { error: null }
    },
    signInWithGoogle: async () => {
      if (!isSupabaseConfigured) return { error: 'Supabase не настроен' }
      const options = { redirectTo: appRedirectUrl(), queryParams: { access_type: 'offline', prompt: 'select_account' } }
      const result = user?.isAnonymous
        ? await supabase.auth.linkIdentity({ provider: 'google', options })
        : await supabase.auth.signInWithOAuth({ provider: 'google', options })
      return { error: result.error ? translateAuthError(result.error.message) : null }
    },
    signInAnonymously: async () => {
      if (!isSupabaseConfigured) return { error: 'Supabase не настроен' }
      const { error } = await supabase.auth.signInAnonymously()
      return { error: error ? translateAuthError(error.message) : null }
    },
    updateProfile: async (updates) => {
      if (!user || user.isAnonymous) return 'Постоянный аккаунт нужен для сохранения профиля'
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
  if (normalized.includes('error sending magic link email') || normalized.includes('error sending email') || normalized.includes('smtp')) return 'Письмо не отправлено: проверьте Email provider и SMTP в Supabase.'
  if (normalized.includes('invalid') && normalized.includes('token')) return 'Код истёк или введён неверно. Запросите новый код'
  if (normalized.includes('expired')) return 'Срок действия кода истёк. Запросите новый код'
  if (normalized.includes('email not confirmed')) return 'Подтвердите email кодом из письма'
  if (normalized.includes('email rate limit') || normalized.includes('rate limit') || normalized.includes('too many') || normalized.includes('over_email')) return 'Сейчас временно недоступна отправка писем. Попробуйте войти через Google.'
  if (normalized.includes('anonymous')) return 'Временная сессия сейчас недоступна. Продолжите как гость или войдите через Google.'
  if (normalized.includes('user not found')) return 'Пользователь не найден. Выберите регистрацию'
  if (normalized.includes('signups not allowed')) return 'Регистрация отключена в настройках Supabase'
  return message
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
