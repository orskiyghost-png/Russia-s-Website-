import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User as SupabaseUser } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { AuthUser } from './types'

type AuthResult = { error: string | null; needsVerification?: boolean }
type AuthContextValue = {
  user: AuthUser | null
  loading: boolean
  configured: boolean
  login: (email: string, password: string) => Promise<AuthResult>
  register: (name: string, email: string, password: string) => Promise<AuthResult>
  updateProfile: (updates: Partial<Pick<AuthUser, 'name' | 'city' | 'notifications'>>) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

type ProfileRow = { name: string; city: string; notifications: boolean; created_at: string }

async function hydrateUser(sessionUser: SupabaseUser): Promise<AuthUser> {
  const { data } = await supabase.from('profiles').select('name, city, notifications, created_at').eq('id', sessionUser.id).maybeSingle()
  const profile = data as ProfileRow | null
  return { id: sessionUser.id, email: sessionUser.email ?? '', name: profile?.name ?? sessionUser.user_metadata.name ?? sessionUser.email?.split('@')[0] ?? 'Гость', city: profile?.city ?? 'Москва', notifications: profile?.notifications ?? true, createdAt: profile ? new Date(profile.created_at).getTime() : Date.now() }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
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
    user,
    loading,
    configured: isSupabaseConfigured,
    login: async (email, password) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment' }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      return { error: error?.message ? translateAuthError(error.message) : null }
    },
    register: async (name, email, password) => {
      if (!isSupabaseConfigured) return { error: 'Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Environment' }
      if (name.trim().length < 2) return { error: 'Введите имя от 2 символов' }
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return { error: 'Проверьте формат email' }
      if (password.length < 6) return { error: 'Пароль должен быть не короче 6 символов' }
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() }, emailRedirectTo: window.location.origin } })
      if (error) return { error: translateAuthError(error.message) }
      if (!data.session) return { error: null, needsVerification: true }
      return { error: null }
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
  if (message.toLowerCase().includes('invalid login')) return 'Неверный email или пароль'
  if (message.toLowerCase().includes('already registered')) return 'Этот email уже зарегистрирован'
  if (message.toLowerCase().includes('email not confirmed')) return 'Подтвердите email по ссылке из письма'
  if (message.toLowerCase().includes('rate limit')) return 'Слишком много попыток. Попробуйте позже'
  return message
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
