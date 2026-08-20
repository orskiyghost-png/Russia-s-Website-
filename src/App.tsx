import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Crosshair,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Send,
  MessageCircle,
  Navigation,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { CityMap, LocateMeButton } from './CityMap'
import { useAuth } from './auth'
import { DEFAULT_CENTER, createEvent as createServerEvent, fetchEvents, kindConfig, layerConfig, relativeTime, subscribeToEvents } from './data'
import type { EventKind, Layer, RadarEvent } from './types'

const spring = { type: 'spring' as const, stiffness: 320, damping: 30 }
const OTP_EMAIL_QUOTA_KEY = 'pulse-otp-email-quota-until'
const OTP_EMAIL_QUOTA_MS = 60 * 60 * 1000

function otpQuotaLocked() {
  try { return Number(window.localStorage.getItem(OTP_EMAIL_QUOTA_KEY) ?? 0) > Date.now() } catch { return false }
}

function lockOtpQuota() {
  try { window.localStorage.setItem(OTP_EMAIL_QUOTA_KEY, String(Date.now() + OTP_EMAIL_QUOTA_MS)) } catch { /* storage may be disabled */ }
}

function isOtpQuotaError(message: string) {
  return /слишком много попыток|rate limit|too many|email rate limit|over_email/i.test(message)
}

type Toast = { message: string; tone?: 'error' | 'success' }

function App() {
  const { user, loading: authLoading, configured } = useAuth()
  const theme = 'light' as const
  const [events, setEvents] = useState<RadarEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [savingEvent, setSavingEvent] = useState(false)
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER)
  const [selectedEvent, setSelectedEvent] = useState<RadarEvent | null>(null)
  const [activeLayer, setActiveLayer] = useState<Layer>('all')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [isReportOpen, setIsReportOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [isAiOpen, setIsAiOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return events.filter((event) => {
      const matchesLayer = activeLayer === 'all' || event.kind === activeLayer
      const matchesQuery = !normalized || `${event.title} ${event.description} ${event.location} ${event.category}`.toLowerCase().includes(normalized)
      return matchesLayer && matchesQuery
    })
  }, [activeLayer, events, query])

  const notify = (message: string, tone: Toast['tone'] = 'success') => {
    setToast({ message, tone })
    window.setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    let active = true
    const refreshEvents = async () => {
      try {
        setEventsLoading(true)
        const result = await fetchEvents()
        if (active) setEvents(result.events)
      } catch {
        if (active) notify('Не удалось загрузить события', 'error')
      } finally {
        if (active) setEventsLoading(false)
      }
    }
    void refreshEvents()
    const unsubscribe = subscribeToEvents(() => { void refreshEvents() })
    return () => { active = false; unsubscribe() }
  }, [])

  const searchCity = async () => {
    const value = query.trim()
    if (!value || searching) return
    setSearching(true)
    setSearchMessage('')
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(value)}`)
      if (!response.ok) throw new Error('geocoding')
      const places = await response.json() as Array<{ lat: string; lon: string; display_name: string }>
      if (!places.length) {
        setSearchMessage('Город не найден')
        return
      }
      const place = places[0]
      setCenter([Number(place.lat), Number(place.lon)])
      setQuery('')
      setSearchMessage(place.display_name.split(',').slice(0, 2).join(', '))
      setSelectedEvent(null)
    } catch {
      setSearchMessage('Не удалось связаться с Nominatim')
    } finally {
      setSearching(false)
    }
  }

  const openReportAt = (coords?: { lat: number; lng: number }) => {
    if (!user) {
      setIsAuthOpen(true)
      notify('Войдите, чтобы добавлять события', 'error')
      return
    }
    setPendingCoords(coords ?? { lat: center[0], lng: center[1] })
    setIsReportOpen(true)
  }

  const createEvent = async (payload: { kind: EventKind; title: string; description: string }) => {
    if (!pendingCoords || !user || savingEvent) return
    const config = kindConfig[payload.kind]
    setSavingEvent(true)
    try {
      const newEvent = await createServerEvent({ ...payload, category: config.label, lat: pendingCoords.lat, lng: pendingCoords.lng })
      setEvents((current) => [newEvent, ...current])
      setCenter([newEvent.lat, newEvent.lng])
      setSelectedEvent(newEvent)
      setIsReportOpen(false)
      setPendingCoords(null)
      notify('Событие опубликовано для всех жителей')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      notify(message.includes('RATE_LIMIT') ? 'Лимит: максимум 5 меток за 10 минут' : 'Не удалось сохранить событие', 'error')
    } finally {
      setSavingEvent(false)
    }
  }

  return <div className="pulse-app">
    <header className="pulse-header glass-panel">
      <button className="pulse-logo" onClick={() => { setCenter(DEFAULT_CENTER); setSelectedEvent(null) }} aria-label="В центр карты">
        <span className="logo-orbit"><span /></span><span className="logo-word">PULSE<span>.</span></span>
      </button>
      <div className="header-search-wrap">
        <Search size={16} />
        <input className="text-[16px]" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchCity() }} placeholder="Найти город или событие" aria-label="Поиск города" />
        {searching && <span className="search-status">ищем…</span>}
        <kbd>⌘ K</kbd>
        {searchMessage && <span className="search-result-label">{searchMessage}</span>}
      </div>
      <div className="header-actions">
        <span className="live-indicator"><i /> live</span>
        <button className="header-icon-button notification-button" onClick={() => setIsNotificationsOpen(true)} aria-label="Уведомления"><Bell size={17} /><span className="unread-dot" /></button>
        {user ? <button className="user-chip" onClick={() => setIsProfileOpen(true)}><span className="user-avatar">{initials(user.name)}</span><span className="user-name">{user.name}</span><ChevronDown size={14} /></button> : <button className="login-button" onClick={() => setIsAuthOpen(true)}><LogIn size={15} /> Войти</button>}
        <button className="mobile-menu-button header-icon-button" onClick={() => setIsMenuOpen((value) => !value)} aria-label="Открыть меню"><Menu size={18} /></button>
      </div>
    </header>

    <AnimatePresence initial={false}>
      {isMenuOpen && <motion.button className="drawer-backdrop" aria-label="Закрыть меню" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} onClick={() => setIsMenuOpen(false)} />}
      <motion.aside className="layer-rail glass-panel" initial={{ x: '-108%', opacity: 0 }} animate={{ x: isMenuOpen ? 0 : '-108%', opacity: isMenuOpen ? 1 : 0 }} exit={{ x: '-108%', opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.72 }} aria-hidden={!isMenuOpen}>
        <div className="rail-heading"><span>СЛОИ РАДАРА</span><button onClick={() => setIsMenuOpen(false)}><X size={15} /></button></div>
        {layerConfig.map((layer) => { const LayerIcon = layer.icon; return <motion.button key={layer.id} whileTap={{ scale: 0.98 }} className={`layer-button ${activeLayer === layer.id ? 'active' : ''}`} onClick={() => { setActiveLayer(layer.id); setIsMenuOpen(false) }}><span className={`layer-symbol ${layer.color}`}><LayerIcon size={16} /></span><span>{layer.label}</span>{layer.id === 'all' && <b>{events.length}</b>}</motion.button> })}
        <div className="rail-divider" />
        <button className="layer-button" onClick={() => openReportAt()}><span className="layer-symbol lime"><Plus size={16} /></span><span>Добавить метку</span></button>
        <div className="rail-footer"><div className="ai-badge"><Sparkles size={14} /><span><strong>PULSE AI</strong><small>42 источника онлайн</small></span></div><span className="connection-state"><i /> синхронизировано</span></div>
      </motion.aside>
    </AnimatePresence>

    <main className="map-stage">
      <CityMap center={center} events={filteredEvents} selectedId={selectedEvent?.id} theme={theme} onSelect={setSelectedEvent} onMapClick={openReportAt} />
      {(eventsLoading || searching || authLoading) && <MapSkeleton label={searching ? 'Ищем город…' : 'Синхронизируем радар…'} />}
      <div className="map-vignette" />
      <div className="map-title-wash" aria-hidden="true" />
      <div className="map-title-block"><p>ОРСК · ОБНОВЛЕНО ТОЛЬКО ЧТО</p><h1>Город в реальном <em>времени</em></h1><span><Users size={13} /> {events.length} сигналов в радиусе 2 км</span></div>
      <div className="map-controls glass-panel"><LocateMeButton onLocated={(location) => { setCenter(location); notify('Карта центрирована на вас') }} onError={(message) => notify(message, 'error')} /><button className="map-floating-control" onClick={() => setCenter(DEFAULT_CENTER)} title="Вернуться к Орску" aria-label="Вернуться к Орску"><Navigation size={16} /></button></div>
      <button className="ai-fab glass-panel" onClick={() => setIsAiOpen((value) => !value)} aria-label="Открыть PULSE AI"><Bot size={18} /><span>PULSE AI</span></button>

      <AnimatePresence>{selectedEvent && <EventSheet event={selectedEvent} onClose={() => setSelectedEvent(null)} onReact={() => notify('Реакция сохранена')} />}</AnimatePresence>
      <motion.div className="event-strip" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}>
        <div className="strip-heading"><span><Activity size={14} /> В ЭФИРЕ</span><b>{filteredEvents.length} событий</b></div>
        <div className="strip-list">{filteredEvents.slice(0, 4).map((event) => <MiniEvent key={event.id} event={event} selected={event.id === selectedEvent?.id} onClick={() => setSelectedEvent(event)} />)}</div>
      </motion.div>
    </main>    {!configured && <div className="backend-banner glass-panel"><Zap size={14} /><span>Локальный режим: подключите Supabase, чтобы включить общие события и Email OTP</span><button onClick={() => setIsAuthOpen(true)}>Настроить <ArrowRight size={13} /></button></div>}
    <div className="bottom-actions glass-panel"><button onClick={() => openReportAt()} className="add-event-button"><Plus size={17} /> Создать сигнал <kbd>⌘ N</kbd></button><span className="desktop-only-hint"><Crosshair size={13} /> Нажмите на карту, чтобы поставить метку в Орске</span></div>

    <AnimatePresence>{isAuthOpen && <AuthModal onClose={() => setIsAuthOpen(false)} onSuccess={() => { setIsAuthOpen(false); notify('Добро пожаловать в PULSE') }} />}</AnimatePresence>
    <AnimatePresence>{isReportOpen && pendingCoords && <ReportModal coords={pendingCoords} onClose={() => { setIsReportOpen(false); setPendingCoords(null) }} onSubmit={createEvent} />}</AnimatePresence>
    <AnimatePresence>{isProfileOpen && user && <ProfileModal onClose={() => setIsProfileOpen(false)} />}</AnimatePresence>
    <AnimatePresence>{isNotificationsOpen && <NotificationsPanel onClose={() => setIsNotificationsOpen(false)} />}</AnimatePresence><AnimatePresence>{isAiOpen && <PulseAiPanel events={filteredEvents} onClose={() => setIsAiOpen(false)} />}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className={`toast-message ${toast.tone ?? 'success'}`} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}><span>{toast.tone === 'error' ? <X size={15} /> : <Check size={15} />}</span>{toast.message}</motion.div>}</AnimatePresence>
  </div>
}

function MiniEvent({ event, selected, onClick }: { event: RadarEvent; selected: boolean; onClick: () => void }) {
  const config = kindConfig[event.kind]
  const Icon = config.icon
  const isHot = Date.now() - event.createdAt < 45 * 60_000
  return <motion.button className={`mini-event ${selected ? 'selected' : ''} ${isHot ? 'hot' : ''}`} onClick={onClick} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, duration: .45 }} whileTap={{ scale: .98 }}><span className={`mini-event-icon ${config.color}`}><Icon size={15} /></span><span className="mini-event-copy"><strong>{event.title}</strong><small><MapPin size={11} /> {event.location}</small></span><span className="mini-event-time">{relativeTime(event.createdAt)}</span><ChevronRight size={14} /></motion.button>
}

function EventSheet({ event, onClose, onReact }: { event: RadarEvent; onClose: () => void; onReact: () => void }) {
  const config = kindConfig[event.kind]
  const Icon = config.icon
  return <motion.aside className="event-sheet glass-panel" initial={{ opacity: 0, y: 28, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} transition={spring}><div className="sheet-top"><span className={`event-tag ${config.color}`}><Icon size={13} /> {event.category}</span><button className="sheet-close" onClick={onClose}><X size={16} /></button></div><h2>{event.title}</h2><p className="sheet-description">{event.description}</p><div className="sheet-meta"><span><MapPin size={13} /> {event.location}</span><span><Clock3 size={13} /> {relativeTime(event.createdAt)}</span></div><div className="sheet-footer"><span className="sheet-user"><span className="tiny-avatar">{event.avatarUrl ? <img src={event.avatarUrl} alt="" /> : initials(event.userName)}</span>{event.userName}</span><button className="sheet-react" onClick={onReact}><ThumbsUp size={14} /> {event.reactions}</button><span className="sheet-comments"><MessageCircle size={14} /> {event.comments}</span></div></motion.aside>
}

function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { login, register, verifyOtp } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [step, setStep] = useState<'email' | 'otp'>('email')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [otpErrorPulse, setOtpErrorPulse] = useState(false)
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])
  const submitEmail = async () => {
    if (submitting || resendCooldown > 0) return
    if (otpQuotaLocked()) { setError('Лимит отправки писем уже исчерпан. Подождите около часа и попробуйте снова.'); return }
    const normalizedEmail = email.trim()
    setEmail(normalizedEmail)
    setError(''); setNotice(''); setSubmitting(true)
    const result = mode === 'login' ? await login(normalizedEmail) : await register(name, normalizedEmail)
    if (result.error) {
      setError(result.error)
      if (isOtpQuotaError(result.error)) lockOtpQuota()
      if (result.error.includes('Письмо не отправлено')) setNotice('Если письмо не приходит, владельцу проекта необходимо включить встроенный SMTP в настройках Supabase')
    } else { setStep('otp'); setResendCooldown(60); setNotice(`Код отправлен на ${normalizedEmail}`); window.setTimeout(() => inputs.current[0]?.focus(), 50) }
    setSubmitting(false)
  }
  const resendOtp = async () => {
    if (submitting || resendCooldown > 0) return
    if (otpQuotaLocked()) { setError('Лимит отправки писем уже исчерпан. Подождите около часа и попробуйте снова.'); return }
    setError(''); setNotice(''); setSubmitting(true)
    const result = mode === 'login' ? await login(email) : await register(name, email)
    if (result.error) { setError(result.error); if (isOtpQuotaError(result.error)) lockOtpQuota() }
    else { setDigits(['', '', '', '', '', '']); setResendCooldown(60); setNotice(`Новый код отправлен на ${email.trim()}`); window.setTimeout(() => inputs.current[0]?.focus(), 50) }
    setSubmitting(false)
  }
  const updateDigit = (index: number, value: string) => {
    const numeric = value.replace(/\D/g, '')
    if (numeric.length > 1) {
      const next = [...digits]
      numeric.slice(0, 6 - index).split('').forEach((digit, offset) => { next[index + offset] = digit })
      setDigits(next); setError('')
      const focusIndex = Math.min(index + numeric.length, 5)
      inputs.current[focusIndex]?.focus()
      if (next.every(Boolean)) window.setTimeout(() => { void submitCode(next.join('')) }, 50)
      return
    }
    const next = [...digits]; next[index] = numeric; setDigits(next); setError('')
    if (numeric && index < 5) inputs.current[index + 1]?.focus()
    if (next.every(Boolean)) window.setTimeout(() => { void submitCode(next.join('')) }, 50)
  }
  const submitCode = async (code = digits.join('')) => {
    setError(''); setSubmitting(true)
    const result = await verifyOtp(email, code)
    if (result.error) { setError(result.error); setNotice('Если код не принимается, запросите новый код и проверьте, что он введён без пробелов.'); setDigits(['', '', '', '', '', '']); setOtpErrorPulse(true); window.setTimeout(() => setOtpErrorPulse(false), 420); inputs.current[0]?.focus() } else onSuccess()
    setSubmitting(false)
  }
  return <ModalFrame onClose={onClose}><div className="auth-modal w-full max-w-md mx-auto px-4 sm:px-6"><div className="modal-orbit"><Sparkles size={19} /></div><p className="modal-overline">PULSE ACCOUNT / {step === 'otp' ? 'VERIFY' : 'ACCESS'}</p><h2>{step === 'otp' ? 'Введите код' : mode === 'login' ? 'С возвращением' : 'Присоединиться к городу'}<span>.</span></h2><p className="modal-subtitle">{step === 'otp' ? `Шесть цифр из письма для ${email.trim()}.` : mode === 'login' ? 'Войдите, чтобы сохранять места и добавлять сигналы.' : 'Создайте аккаунт и начните видеть свой город иначе.'}</p>{step === 'email' ? <><div className="auth-provider-note"><span>Без пароля</span><strong>Вход по email с одноразовым кодом</strong></div><div className="auth-divider"><span>Доступ через email</span></div><div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Войти</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Регистрация</button></div>{mode === 'register' && <label className="input-label">Имя<input className="text-[16px]" value={name} onChange={(event) => setName(event.target.value)} placeholder="Как к вам обращаться?" autoComplete="name" /></label>}<label className="input-label">Email<input className="text-[16px]" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" autoComplete="email" /></label><button className="primary-action" disabled={submitting} onClick={() => { void submitEmail() }}>{submitting ? 'Отправляем…' : 'Получить 6-значный код'}<ArrowRight size={16} /></button></> : <><div className={`otp-grid ${otpErrorPulse ? 'otp-grid-error' : ''}`} role="group" aria-label="6-значный код">{digits.map((digit, index) => <input key={index} ref={(element) => { inputs.current[index] = element }} className="otp-cell text-[16px]" inputMode="numeric" pattern="[0-9]*" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={index === 0 ? 6 : 1} value={digit} onChange={(event) => updateDigit(index, event.target.value)} onPaste={(event) => { event.preventDefault(); updateDigit(index, event.clipboardData.getData('text')) }} onKeyDown={(event) => { if (event.key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus() }} aria-label={`Цифра ${index + 1}`} />)}</div><button className="primary-action" disabled={submitting || digits.some((digit) => !digit)} onClick={() => { void submitCode() }}>{submitting ? 'Проверяем…' : 'Подтвердить код'}<Check size={16} /></button><div className="otp-actions"><button className="otp-resend" disabled={submitting || resendCooldown > 0} onClick={() => { void resendOtp() }}>{resendCooldown > 0 ? `Повторная отправка через ${resendCooldown} с` : 'Отправить код повторно'}</button><button className="otp-change" disabled={submitting} onClick={() => { setStep('email'); setDigits(['', '', '', '', '', '']); setNotice(''); setError('') }}>Изменить email</button></div></>}{error && <p className="form-error">{error}</p>}{notice && <p className="form-notice">{notice}</p>}<p className="auth-disclaimer">PULSE использует одноразовый 6-значный код. Пароль и переходы по ссылкам не нужны.</p></div></ModalFrame>
}

function ReportModal({ coords, onClose, onSubmit }: { coords: { lat: number; lng: number }; onClose: () => void; onSubmit: (payload: { kind: EventKind; title: string; description: string }) => void }) {
  const [kind, setKind] = useState<EventKind>('vibe')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  return <ModalFrame onClose={onClose}><div className="report-modal"><div className="modal-heading-row"><div><p className="modal-overline">НОВЫЙ СИГНАЛ</p><h2>Добавить на карту<span>.</span></h2></div><span className="coordinate-chip"><MapPin size={12} /> {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span></div><p className="modal-subtitle">Сообщите соседям, что происходит в этой точке.</p><div className="category-grid">{(Object.keys(kindConfig) as EventKind[]).map((item) => { const config = kindConfig[item]; const Icon = config.icon; return <button key={item} className={`category-option ${config.color} ${kind === item ? 'selected' : ''}`} onClick={() => setKind(item)}><Icon size={17} /><span>{config.label}</span>{kind === item && <Check size={14} />}</button> })}</div><label className="input-label">Заголовок<input className="text-[16px]" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, тихий двор с музыкой" maxLength={80} /></label><label className="input-label">Подробнее<textarea className="text-[16px]" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Что важно знать другим?" maxLength={240} /></label><button className="primary-action" disabled={!title.trim() || !description.trim()} onClick={() => onSubmit({ kind, title: title.trim(), description: description.trim() })}>Опубликовать сигнал <ArrowRight size={16} /></button></div></ModalFrame>
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateProfile, logout } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [city, setCity] = useState(user?.city ?? 'Орск')
  const [notifications, setNotifications] = useState(user?.notifications ?? true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!user) return null
  const save = async () => { setSaving(true); const result = await updateProfile({ name: name.trim() || user.name, city, notifications }); if (result) setError(result); else onClose(); setSaving(false) }
  return <ModalFrame onClose={onClose}><div className="profile-modal"><div className="profile-modal-header"><div className="large-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}</div><div><p className="modal-overline">МОЙ PULSE</p><h2>{user.name}<span>.</span></h2><span className="profile-email">{user.email}</span></div></div><div className="profile-form"><label className="input-label">Ваше имя<input className="text-[16px]" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="input-label">Родной город<div className="select-wrap"><Navigation size={15} /><select className="text-[16px]" value={city} onChange={(event) => setCity(event.target.value)}><option>Орск</option><option>Москва</option><option>Санкт-Петербург</option><option>Екатеринбург</option><option>Казань</option></select><ChevronDown size={14} /></div></label><button className="setting-toggle" onClick={() => setNotifications((value) => !value)}><span><Bell size={16} /><span><strong>Уведомления рядом</strong><small>Получать важные сигналы в вашем городе</small></span></span><i className={notifications ? 'on' : ''}><b /></i></button></div>{error && <p className="form-error">{error}</p>}<div className="profile-actions"><button className="logout-action" onClick={() => { void logout(); onClose() }}><LogOut size={15} /> Выйти</button><button className="primary-action compact" disabled={saving} onClick={() => { void save() }}>{saving ? 'Сохраняем…' : 'Сохранить'} <Check size={15} /></button></div></div></ModalFrame>
}

function PulseAiPanel({ events, onClose }: { events: RadarEvent[]; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [question, setQuestion] = useState('')
  const summary = events.length === 0 ? 'На районе сейчас спокойно. Новых сигналов в видимой области пока нет — самое время добавить наблюдение.' : `В видимой области ${events.length} ${events.length === 1 ? 'сигнал' : 'сигналов'}. ${events.filter((event) => event.kind === 'help').length ? 'Есть соседские предложения помощи.' : 'Бартерных предложений пока не видно.'} Последнее обновление — только что.`
  useEffect(() => { setTyped(''); let index = 0; const timer = window.setInterval(() => { index += 1; setTyped(summary.slice(0, index)); if (index >= summary.length) window.clearInterval(timer) }, 18); return () => window.clearInterval(timer) }, [summary])
  return <motion.aside className="ai-panel glass-panel" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: .98 }} transition={spring}><div className="ai-panel-head"><div><span className="ai-kicker"><Bot size={14} /> PULSE AI</span><h2>Что происходит рядом?</h2></div><button className="sheet-close" onClick={onClose} aria-label="Закрыть AI"><X size={17} /></button></div><div className="ai-message"><span className="ai-message-avatar"><Sparkles size={15} /></span><p>{typed}<span className="typing-cursor">▍</span></p></div><div className="ai-suggestions"><button onClick={() => setQuestion('Где сейчас спокойнее?')}>Где спокойнее?</button><button onClick={() => setQuestion('Есть ли помощь рядом?')}>Помощь рядом</button></div><div className="ai-input"><input className="text-[16px]" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Спросить про район…" onKeyDown={(event) => { if (event.key === 'Enter' && question.trim()) setQuestion('Пока я умею только читать карту — скоро подключу полный AI-ответ.') }} /><button onClick={() => { if (question.trim()) setQuestion('Пока я умею только читать карту — скоро подключу полный AI-ответ.') }} aria-label="Отправить"><Send size={15} /></button></div></motion.aside>
}

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  return <motion.aside className="notifications-panel glass-panel" initial={{ x: 26, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 26, opacity: 0 }} transition={spring}><div className="panel-header"><div><p className="modal-overline">PULSE / INBOX</p><h2>Уведомления</h2></div><button className="sheet-close" onClick={onClose}><X size={17} /></button></div><div className="notification-row unread"><span className="notification-icon pink"><ThumbsUp size={15} /></span><div><strong>Ваш сигнал поддержали</strong><p>5 человек оценили «Новый спот для скейта»</p><small>8 минут назад</small></div></div><div className="notification-row unread"><span className="notification-icon lime"><Sparkles size={15} /></span><div><strong>PULSE AI заметил всплеск</strong><p>На Чистых прудах сейчас необычно много людей</p><small>24 минуты назад</small></div></div><div className="notification-row"><span className="notification-icon blue"><Users size={15} /></span><div><strong>Сосед рядом предлагает помощь</strong><p>Домашний хлеб на Климентовском, 8</p><small>1 час назад</small></div></div></motion.aside>
}

function ModalFrame({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}><Dialog.Portal><Dialog.Overlay asChild><motion.div className="dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /></Dialog.Overlay><Dialog.Content asChild><motion.div className="modal-card glass-panel" initial={{ y: 18, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 18, opacity: 0, scale: .98 }} transition={spring}><Dialog.Title className="sr-only">PULSE</Dialog.Title><Dialog.Description className="sr-only">Окно PULSE</Dialog.Description><Dialog.Close asChild><button className="modal-close" aria-label="Закрыть"><X size={17} /></button></Dialog.Close>{children}</motion.div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function MapSkeleton({ label }: { label: string }) {
  return <motion.div className="map-skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><div className="skeleton-orbit"><span /></div><div className="skeleton-copy"><strong>{label}</strong><span>Данные обновляются в реальном времени</span></div></motion.div>
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() }

export default App
