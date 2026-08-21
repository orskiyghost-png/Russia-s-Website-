import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
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
  MessageSquare,
  Navigation,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  UserRound,
  Users,
  X,
  Zap,
  Moon,
  Sun,
} from 'lucide-react'
import { CityMap, LocateMeButton } from './CityMap'
import { useAuth } from './auth'
import { Captcha } from './Captcha'
import { useTheme } from './theme'

import { DEFAULT_CENTER, addComment, apiErrorKind, createEvent as createServerEvent, eventLayer, fetchComments, fetchDirectMessages, fetchEvents, fetchOpenReports, kindConfig, layerConfig, relativeTime, reportEvent, reverseGeocode, sendDirectMessage, setEventModerationStatus, subscribeToEvents, toggleReaction } from './data'

import type { EventKind, EventComment, Layer, RadarEvent } from './types'

const spring = { type: 'spring' as const, stiffness: 320, damping: 30 }
const panelSpring = { type: 'spring' as const, stiffness: 340, damping: 32, mass: .8 }
const humanLocation = (value: string) => /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(value) ? 'Рядом с Орском' : value

function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}
const SEARCH_FALLBACKS: Record<string, [number, number]> = { орск: [51.2049, 58.5668], москва: [55.7558, 37.6173], казань: [55.7879, 49.1233], екатеринбург: [56.8389, 60.6057], 'санкт-петербург': [59.9343, 30.3351] }

type Toast = { message: string; tone?: 'error' | 'success' }

function App() {
  const { user, loading: authLoading, configured } = useAuth()
  const { theme, toggleTheme } = useTheme()
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
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [isMessagesOpen, setIsMessagesOpen] = useState(false)
  const [messageRecipient, setMessageRecipient] = useState<{ id: string; name: string } | null>(null)
  const [isAiOpen, setIsAiOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return events.filter((event) => {
      const matchesLayer = activeLayer === 'all' || eventLayer(event.category) === activeLayer
      const matchesQuery = !normalized || `${event.title} ${event.description} ${event.location} ${event.category}`.toLowerCase().includes(normalized)
      return matchesLayer && matchesQuery
    })
  }, [activeLayer, events, query])

  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    setToast({ message, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3000)
  }, [])

  const selectEvent = useCallback((event: RadarEvent) => {
    setSelectedEvent({ ...event, commentsList: [] })
    setIsAiOpen(false)
    void fetchComments(event.id).then((commentsList) => {
      setSelectedEvent((current) => current?.id === event.id ? { ...current, commentsList } : current)
    }).catch(() => {
      setSelectedEvent((current) => current?.id === event.id ? { ...current, commentsList: [] } : current)
    })
  }, [])

  const requirePermanentAccount = () => { setIsAuthOpen(true); notify('Войдите, чтобы ставить лайки и писать комментарии', 'error') }

  const reactToEvent = async (event: RadarEvent) => {
    if (!user || user.isAnonymous) { requirePermanentAccount(); return }
    if (event.id.startsWith('orsk-')) { notify('Это демо-событие. Подключите Supabase в Settings → Environment, чтобы ставить реакции.', 'error'); return }
    const previous = event
    const optimisticLiked = !Boolean(event.likedByMe)
    const optimistic = { ...event, likedByMe: optimisticLiked, reactions: Math.max(0, event.reactions + (optimisticLiked ? 1 : -1)) }
    setEvents((current) => current.map((item) => item.id === event.id ? optimistic : item))
    setSelectedEvent((current) => current?.id === event.id ? optimistic : current)
    try {
      const result = await toggleReaction(event.id)
      const next = { ...optimistic, reactions: result.reactions, likedByMe: result.likedByMe }
      setEvents((current) => current.map((item) => item.id === event.id ? next : item))
      setSelectedEvent((current) => current?.id === event.id ? next : current)
      notify(result.likedByMe ? 'Лайк поставлен' : 'Лайк убран')
    } catch (error) {
      setEvents((current) => current.map((item) => item.id === event.id ? previous : item))
      setSelectedEvent((current) => current?.id === event.id ? previous : current)
      const kind = apiErrorKind(error)
      if (kind === 'auth') { requirePermanentAccount(); return }
      if (kind === 'missing-rpc') { notify('Бэкенд не обновлён: примените миграции supabase/migrations в SQL Editor', 'error'); return }
      notify('Не удалось сохранить реакцию. Попробуйте ещё раз.', 'error')
    }
  }

  const openMessagesFor = (event: RadarEvent) => { if (!event.userId || !user || user.isAnonymous) return; setMessageRecipient({ id: event.userId, name: event.userName }); setIsMessagesOpen(true); setSelectedEvent(null) }

  const reportEventFromSheet = async (event: RadarEvent, reason: string) => {
    try {
      await reportEvent(event.id, reason)
      notify('Жалоба отправлена на проверку')
    } catch (error) {
      const kind = apiErrorKind(error)
      if (kind === 'auth') { requirePermanentAccount(); return }
      if (kind === 'missing-rpc') { notify('Бэкенд не обновлён: примените миграции supabase/migrations в SQL Editor', 'error'); return }
      notify('Не удалось отправить жалобу. Попробуйте позже.', 'error')
    }
  }

  const commentOnEvent = async (event: RadarEvent, text: string) => {
    if (!user || user.isAnonymous) { requirePermanentAccount(); return }
    if (event.id.startsWith('orsk-')) { notify('Это демо-событие. Подключите Supabase в Settings → Environment, чтобы писать комментарии.', 'error'); return }
    try {
      const result = await addComment(event.id, text)
      const next = { ...event, comments: result.comments, commentsList: [...(event.commentsList ?? []), result.comment] }
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, comments: result.comments } : item))
      setSelectedEvent((current) => current?.id === event.id ? next : current)
      notify('Комментарий опубликован')
    } catch (error) {
      const kind = apiErrorKind(error)
      if (kind === 'auth') { requirePermanentAccount(); return }
      if (kind === 'missing-rpc') { notify('Бэкенд не обновлён: примените миграции supabase/migrations в SQL Editor', 'error'); return }
      notify(kind === 'rate-limit' ? 'Комментарии временно ограничены. Попробуйте позже.' : 'Не удалось опубликовать комментарий. Попробуйте ещё раз.', 'error')
    }
  }

  useEffect(() => {
    if (user) setIsAuthOpen(false)
  }, [user])

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
    const fallback = SEARCH_FALLBACKS[value.toLowerCase()]
    if (fallback) {
      setCenter(fallback)
      setSelectedEvent(null)
      setQuery('')
      setSearchMessage(value)
      notify(`Карта центрирована: ${value}`)
      setSearching(false)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=${encodeURIComponent(value)}`, { signal: controller.signal })
      if (!response.ok) throw new Error('geocoding')
      const places = await response.json() as Array<{ lat: string; lon: string; display_name: string }>
      if (!places.length) {
        setSearchMessage('Город не найден')
        setQuery('')
        notify('Город не найден', 'error')
        return
      }
      const place = places[0]
      setCenter([Number(place.lat), Number(place.lon)])
      setQuery('')
      setSearchMessage(place.display_name.split(',').slice(0, 2).join(', '))
      setSelectedEvent(null)
      notify('Карта перемещена к результату')
    } catch {
      setSearchMessage('Не удалось связаться с Nominatim')
      setQuery('')
      notify('Поиск временно недоступен. Попробуйте название города ещё раз.', 'error')
    } finally {
      window.clearTimeout(timeout)
      setSearching(false)
    }
  }

  const toggleOrSubmitSearch = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches && !isSearchOpen) {
      setIsSearchOpen(true)
      window.setTimeout(() => searchInputRef.current?.focus(), 0)
      return
    }
    void searchCity()
  }

  const openReportAt = useCallback((coords?: { lat: number; lng: number }) => {
    if (!user || user.isAnonymous) {
      setIsAuthOpen(true)
      notify(user?.isAnonymous ? 'Чтобы сохранить сигнал за аккаунтом, войдите через Email + Password' : 'Войдите, чтобы добавлять события', 'error')
      return
    }
    setPendingCoords(coords ?? { lat: center[0], lng: center[1] })
    setIsReportOpen(true)
  }, [center, notify, user])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches) setIsSearchOpen(true)
        searchInputRef.current?.focus()
      } else if (key === 'n') {
        event.preventDefault()
        openReportAt()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openReportAt])

  const createEvent = async (payload: { kind: EventKind; title: string; description: string }, captchaToken: string) => {
    if (!pendingCoords || !user || user.isAnonymous || savingEvent) return
    // CAPTCHA-токен не блокирует отправку: если виджет недоступен, сервер сам решает (Supabase bot protection).
    const config = kindConfig[payload.kind]
    setSavingEvent(true)
    try {
      let address: string | null = null
      try {
        address = await reverseGeocode(pendingCoords.lat, pendingCoords.lng)
      } catch {
        address = null
      }
      const newEvent = await createServerEvent({ ...payload, category: config.label, lat: pendingCoords.lat, lng: pendingCoords.lng, address })
      setEvents((current) => [newEvent, ...current])
      setCenter([newEvent.lat, newEvent.lng])
      setSelectedEvent(newEvent)
      setIsReportOpen(false)
      setPendingCoords(null)
      notify('Событие опубликовано для всех жителей')
    } catch (error) {
      const kind = apiErrorKind(error)
      notify(kind === 'rate-limit' ? 'Лимит: максимум 5 меток за 10 минут' : kind === 'auth' ? 'Для сигнала нужен постоянный Email + Password аккаунт' : kind === 'missing-rpc' ? 'Бэкенд не обновлён: примените миграции supabase/migrations в SQL Editor' : 'Не удалось сохранить событие', 'error')
    } finally {
      setSavingEvent(false)
    }
  }

  return <div className="pulse-app">
    <header className="pulse-header glass-panel">
      <button className="pulse-logo" onClick={() => { setCenter(DEFAULT_CENTER); setSelectedEvent(null) }} aria-label="В центр карты">
        <span className="logo-orbit"><span /></span><span className="logo-word">PULSE<span>.</span></span>
      </button>
      <div className={`header-search-wrap ${isSearchOpen ? 'search-open' : ''}`}>
        <button className="search-submit" onClick={toggleOrSubmitSearch} aria-label="Искать"><Search size={16} /></button>
        <input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchCity(); else if (event.key === 'Escape') setIsSearchOpen(false) }} placeholder="Найти город или событие" aria-label="Поиск города" />
        {searching && <span className="search-status"><i className="search-spinner" /> ищем…</span>}
        <kbd>⌘ K</kbd>
        {isSearchOpen && <button className="search-close" onClick={() => { setIsSearchOpen(false); setQuery(''); setSearchMessage('') }} aria-label="Закрыть поиск"><X size={14} /></button>}
        {searchMessage && <span className="search-result-label">{searchMessage}</span>}
      </div>
      <div className="header-actions">
        <span className="live-indicator"><i /> В эфире</span>
        <button className="header-icon-button theme-toggle" onClick={toggleTheme} aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'} title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</button>
        <button className="header-icon-button notification-button" onClick={() => setIsNotificationsOpen(true)} aria-label="Уведомления"><Bell size={17} /><span className="unread-dot" /></button>
        {user && !user.isAnonymous ? <button className="user-chip" onClick={() => setIsProfileOpen(true)}><span className="user-avatar"><span>{initials(user.name)}</span>{user.avatarUrl && <img src={user.avatarUrl} alt="" onError={hideBrokenImage} />}</span><span className="user-name">{user.name}</span><ChevronDown size={14} /></button> : user ? <button className="login-button guest-chip" onClick={() => setIsAuthOpen(true)}><UserRound size={15} /> Гость</button> : <button className="login-button" onClick={() => setIsAuthOpen(true)}><LogIn size={15} /> Войти</button>}
        <button className="mobile-menu-button header-icon-button" onClick={() => setIsMenuOpen((value) => !value)} aria-label="Открыть меню"><Menu size={18} /></button>
      </div>
    </header>

    <AnimatePresence initial={false}>
      {isMenuOpen && <motion.button className="drawer-backdrop" aria-label="Закрыть меню" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} onClick={() => setIsMenuOpen(false)} />}
      <motion.aside className="layer-rail glass-panel" initial={{ y: '118%', opacity: 0 }} animate={{ y: isMenuOpen ? 0 : '118%', opacity: isMenuOpen ? 1 : 0 }} exit={{ y: '118%', opacity: 0 }} transition={panelSpring} aria-hidden={!isMenuOpen}>
        <div className="rail-heading"><span>КАТЕГОРИИ</span><button onClick={() => setIsMenuOpen(false)}><X size={15} /></button></div>
        {layerConfig.map((layer) => { const LayerIcon = layer.icon; return <motion.button key={layer.id} whileTap={{ scale: 0.98 }} className={`layer-button ${activeLayer === layer.id ? 'active' : ''}`} onClick={() => { setActiveLayer(layer.id); setIsMenuOpen(false) }}><span className={`layer-symbol ${layer.color}`}><LayerIcon size={16} /></span><span>{layer.label}</span>{layer.id === 'all' && <b>{events.length}</b>}</motion.button> })}
        <div className="rail-divider" />
        <button className="layer-button" onClick={() => openReportAt()}><span className="layer-symbol lime"><Plus size={16} /></span><span>Добавить метку</span></button>
        <div className="rail-footer"><div className="ai-badge"><Sparkles size={14} /><span><strong>PULSE AI</strong><small>Местные сигналы рядом</small></span></div><span className="connection-state"><i /> Город рядом</span></div>
      </motion.aside>
    </AnimatePresence>

    <main className="map-stage">
      <CityMap center={center} events={filteredEvents} selectedId={selectedEvent?.id} theme={theme} onSelect={selectEvent} onMapClick={openReportAt} />
      {(eventsLoading || searching || authLoading) && <MapSkeleton label={searching ? 'Ищем город…' : 'Обновляем события…'} />}
      <div className="map-vignette" />
      <div className="map-title-wash" aria-hidden="true" />
      <div className="map-title-block"><p>ОРСК · ОБНОВЛЕНО ТОЛЬКО ЧТО</p><h1>Город в реальном <em>времени</em></h1><span><Users size={13} /> {events.length} сигналов в радиусе 2 км</span></div>
      <div className="map-controls glass-panel"><LocateMeButton onLocated={(location) => { setCenter(location); notify('Карта центрирована на вас') }} onError={(message) => notify(message, 'error')} /><button className="map-floating-control" onClick={() => setCenter(DEFAULT_CENTER)} title="Вернуться к Орску" aria-label="Вернуться к Орску"><Navigation size={16} /></button></div>
      {!selectedEvent && <button className="ai-fab glass-panel" onClick={() => setIsAiOpen((value) => !value)} aria-label="Открыть PULSE AI"><Bot size={18} /><span>PULSE AI</span></button>}

      <AnimatePresence>{selectedEvent && <EventSheet event={selectedEvent} canInteract={Boolean(user && !user.isAnonymous)} canReport={Boolean(user && !user.isAnonymous)} canMessage={Boolean(user && !user.isAnonymous && selectedEvent.userId)} onRequireAuth={requirePermanentAccount} onClose={() => setSelectedEvent(null)} onReact={() => { void reactToEvent(selectedEvent) }} onComment={(text) => { void commentOnEvent(selectedEvent, text) }} onReport={(reason) => { void reportEventFromSheet(selectedEvent, reason) }} onMessage={() => openMessagesFor(selectedEvent)} />}</AnimatePresence>
      <motion.div className="event-strip" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}>
        <div className="strip-heading"><span><Activity size={14} /> В ЭФИРЕ</span><b>{filteredEvents.length} событий</b></div>
        <div className="strip-list">{filteredEvents.slice(0, 4).map((event) => <MiniEvent key={event.id} event={event} selected={event.id === selectedEvent?.id} onClick={() => selectEvent(event)} />)}</div>
      </motion.div>
    </main>    {!configured && <div className="backend-banner glass-panel"><Zap size={14} /><span>Карта доступна для просмотра. Общие сигналы появятся после подключения аккаунта.</span><button onClick={() => setIsAuthOpen(true)}>Войти <ArrowRight size={13} /></button></div>}
    <div className="bottom-actions glass-panel"><button onClick={() => openReportAt()} className="add-event-button"><Plus size={17} /> Создать сигнал <kbd>⌘ N</kbd></button><span className="desktop-only-hint"><Crosshair size={13} /> Выберите место на карте, чтобы добавить сигнал</span></div>

    <AnimatePresence>{isAuthOpen && <AuthModal onClose={() => setIsAuthOpen(false)} onSuccess={() => { setIsAuthOpen(false); notify('Добро пожаловать в PULSE') }} />}</AnimatePresence>
    <AnimatePresence>{isReportOpen && pendingCoords && <ReportModal coords={pendingCoords} onClose={() => { setIsReportOpen(false); setPendingCoords(null) }} onSubmit={createEvent} />}</AnimatePresence>
    <AnimatePresence>{isProfileOpen && user && <ProfileModal onClose={() => setIsProfileOpen(false)} onAdminOpen={() => { setIsProfileOpen(false); setIsAdminOpen(true) }} />}</AnimatePresence>
    <AnimatePresence>{isNotificationsOpen && <NotificationsPanel onClose={() => setIsNotificationsOpen(false)} />}</AnimatePresence><AnimatePresence>{isMessagesOpen && messageRecipient && <MessagesPanel recipient={messageRecipient} onClose={() => setIsMessagesOpen(false)} onNotify={notify} />}</AnimatePresence><AnimatePresence>{isAdminOpen && user?.role === 'admin' && <AdminPanel events={events} onClose={() => setIsAdminOpen(false)} onNotify={notify} />}</AnimatePresence><AnimatePresence>{isAiOpen && <PulseAiPanel events={filteredEvents} onClose={() => setIsAiOpen(false)} />}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className={`toast-message ${toast.tone ?? 'success'}`} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }}><span>{toast.tone === 'error' ? <X size={15} /> : <Check size={15} />}</span>{toast.message}</motion.div>}</AnimatePresence>
  </div>
}

function MiniEvent({ event, selected, onClick }: { event: RadarEvent; selected: boolean; onClick: () => void }) {
  const config = kindConfig[event.kind]
  const Icon = config.icon
  const isHot = Date.now() - event.createdAt < 45 * 60_000
  return <motion.button className={`mini-event ${selected ? 'selected' : ''} ${isHot ? 'hot' : ''}`} onClick={onClick} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, duration: .45 }} whileTap={{ scale: .98 }}><span className={`mini-event-icon ${config.color}`}><Icon size={15} /></span><span className="mini-event-copy"><strong>{event.title}</strong><small><MapPin size={11} /> {humanLocation(event.location)}</small></span><span className="mini-event-time">{relativeTime(event.createdAt)}</span><ChevronRight size={14} /></motion.button>
}

function EventSheet({ event, canInteract, canReport, canMessage, onRequireAuth, onClose, onReact, onComment, onReport, onMessage }: { event: RadarEvent; canInteract: boolean; canReport: boolean; canMessage: boolean; onRequireAuth: () => void; onClose: () => void; onReact: () => void; onComment: (text: string) => void; onReport: (reason: string) => void; onMessage: () => void }) {
  const config = kindConfig[event.kind]
  const Icon = config.icon
  const [comment, setComment] = useState('')
  const [reportReason, setReportReason] = useState('')
  const [reporting, setReporting] = useState(false)
  const submitComment = () => { const value = comment.trim(); if (!value) return; if (!canInteract) { onRequireAuth(); return } onComment(value); setComment('') }
  const submitReport = () => { const value = reportReason.trim(); if (!value) return; onReport(value); setReportReason(''); setReporting(false) }
  return <motion.aside className="event-sheet glass-panel" initial={{ opacity: 0, y: 28, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} transition={spring}>
    <div className="sheet-top"><span className={`event-tag ${config.color}`}><Icon size={13} /> {event.category}</span><button className="sheet-close" onClick={onClose} aria-label="Закрыть сигнал"><X size={16} /></button></div>
    <h2>{event.title}</h2><p className="sheet-description">{event.description}</p>
    <div className="sheet-meta"><span><MapPin size={13} /> {humanLocation(event.location)}</span><span><Clock3 size={13} /> {relativeTime(event.createdAt)}</span></div>
    <div className="sheet-footer"><span className="sheet-user"><span className="tiny-avatar"><span>{initials(event.userName)}</span>{event.avatarUrl && <img src={event.avatarUrl} alt="" onError={hideBrokenImage} />}</span>{event.userName}</span><button className={`sheet-react ${event.likedByMe ? 'active' : ''}`} onClick={canInteract ? onReact : onRequireAuth} aria-label={event.likedByMe ? 'Убрать лайк' : 'Поставить лайк'}><ThumbsUp size={14} /> {event.reactions}</button><span className="sheet-comments"><MessageCircle size={14} /> {event.comments}</span></div>
    {!!event.commentsList?.length && <div className="comments-list" aria-label="Комментарии">{event.commentsList.map((item) => <div className="comment-item" key={item.id}><span className="tiny-avatar"><span>{initials(item.userName)}</span>{item.avatarUrl && <img src={item.avatarUrl} alt="" onError={hideBrokenImage} />}</span><div><strong>{item.userName}</strong><p>{item.body}</p></div></div>)}</div>}
    <form className="comment-form" onSubmit={(event) => { event.preventDefault(); submitComment() }}><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Написать комментарий…" aria-label="Комментарий" /><button type="submit" disabled={!comment.trim()} aria-label="Добавить комментарий"><Send size={14} /></button></form>
    {canMessage && <button className="text-action" onClick={onMessage}><MessageSquare size={14} /> Написать автору</button>}
    {canReport && !event.id.startsWith('orsk-') && <div className="report-area">{reporting ? <form className="report-form" onSubmit={(formEvent) => { formEvent.preventDefault(); submitReport() }}><input value={reportReason} onChange={(inputEvent) => setReportReason(inputEvent.target.value)} placeholder="Что нужно проверить?" aria-label="Причина жалобы" /><button type="submit" disabled={reportReason.trim().length < 3}>Отправить</button></form> : <button className="text-action" onClick={() => setReporting(true)}>Пожаловаться на сигнал</button>}</div>}
  </motion.aside>
}

function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (submitting) return
    setError('')
    if (password.length < 6) { setError('Пароль должен содержать минимум 6 символов'); return }
    if (mode === 'register' && password !== confirmPassword) { setError('Пароли не совпадают'); return }
    // CAPTCHA-токен не блокирует отправку: если виджет недоступен, сервер сам решает.
    setSubmitting(true)
    try {
      const result = mode === 'login' ? await login(email, password, captchaToken) : await register(name, email, password, captchaToken)
      if (result.error) setError(result.error)
      else onSuccess()
    } catch {
      setError('Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.')
    } finally {
      setSubmitting(false)
    }
  }

  return <ModalFrame onClose={onClose}><div className="auth-modal">
    <div className="modal-orbit"><ShieldCheck size={19} /></div>
    <p className="modal-overline">PULSE ACCOUNT / ACCESS</p>
    <h2>{mode === 'login' ? 'Войти в PULSE' : 'Создать аккаунт'}<span>.</span></h2>
    <p className="modal-subtitle">Карта и поиск доступны гостям. Аккаунт нужен для публикации и сохранения сигналов.</p>
    <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setCaptchaToken('') }}>Вход</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setCaptchaToken('') }}>Регистрация</button></div>
    {mode === 'register' && <label className="input-label">Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Как к вам обращаться?" autoComplete="name" /></label>}
    <label className="input-label">Email<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" autoComplete="email" /></label>
    <label className="input-label">Пароль<input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Минимум 6 символов" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
    {mode === 'register' && <label className="input-label">Повторите пароль<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Повторите пароль" type="password" autoComplete="new-password" /></label>}
    <Captcha onToken={setCaptchaToken} onError={setError} />
    <button className="primary-action" disabled={submitting} onClick={() => { void submit() }}>{submitting ? 'Проверяем…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}<ArrowRight size={16} /></button>
    {error && <p className="form-error">{error}</p>}
    <button className="auth-choice auth-choice-quiet guest-auth-button" disabled={submitting} onClick={onClose}><span className="auth-choice-icon"><MapIcon size={16} /></span><span><strong>Продолжить без аккаунта</strong><small>Просмотр карты и поиск доступны гостям</small></span></button>
    <p className="auth-disclaimer">Вход и регистрация защищены капчей hCaptcha.</p>
  </div></ModalFrame>
}

function ReportModal({ coords, onClose, onSubmit }: { coords: { lat: number; lng: number }; onClose: () => void; onSubmit: (payload: { kind: EventKind; title: string; description: string }, captchaToken: string) => void }) {
  const [kind, setKind] = useState<EventKind>('vibe')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  return <ModalFrame onClose={onClose}><div className="report-modal"><div className="modal-heading-row"><div><p className="modal-overline">НОВЫЙ СИГНАЛ</p><h2>Добавить на карту<span>.</span></h2></div><span className="coordinate-chip"><MapPin size={12} /> {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span></div><p className="modal-subtitle">Сообщите соседям, что происходит в этой точке.</p><div className="category-grid">{(Object.keys(kindConfig) as EventKind[]).map((item) => { const config = kindConfig[item]; const Icon = config.icon; return <button key={item} className={`category-option ${config.color} ${kind === item ? 'selected' : ''}`} onClick={() => setKind(item)}><Icon size={17} /><span>{config.label}</span>{kind === item && <Check size={14} />}</button> })}</div><label className="input-label">Заголовок<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, тихий двор с музыкой" maxLength={80} /></label><label className="input-label">Подробнее<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Что важно знать другим?" maxLength={240} /></label><Captcha onToken={setCaptchaToken} onError={setCaptchaError} />{captchaError && <p className="form-error">{captchaError}</p>}<button className="primary-action" disabled={!title.trim() || !description.trim()} onClick={() => onSubmit({ kind, title: title.trim(), description: description.trim() }, captchaToken)}>Опубликовать сигнал <ArrowRight size={16} /></button></div></ModalFrame>
}

function ProfileModal({ onClose, onAdminOpen }: { onClose: () => void; onAdminOpen: () => void }) {
  const { user, updateProfile, logout } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [city, setCity] = useState(user?.city ?? 'Орск')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [neighborhood, setNeighborhood] = useState(user?.neighborhood ?? '')
  const [notifications, setNotifications] = useState(user?.notifications ?? true)
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const avatarInput = useRef<HTMLInputElement | null>(null)
  if (!user) return null
  const handleAvatar = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) { setError('Выберите изображение из галереи'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => { const size = 256; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const context = canvas.getContext('2d'); if (!context) return; const scale = Math.max(size / image.width, size / image.height); const width = image.width * scale; const height = image.height * scale; context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height); setAvatarPreview(canvas.toDataURL('image/jpeg', .84)) }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }
  const save = async () => { setSaving(true); const result = await updateProfile({ name: name.trim() || user.name, city, bio: bio.trim() || null, neighborhood: neighborhood.trim() || null, notifications, avatarUrl: avatarPreview || null }); if (result) setError(result); else onClose(); setSaving(false) }
  return <ModalFrame onClose={onClose}><div className="profile-modal"><div className="profile-modal-header"><button className="profile-avatar-button" onClick={() => avatarInput.current?.click()} aria-label="Изменить аватар"><span className="large-avatar"><span>{initials(user.name)}</span>{avatarPreview && <img src={avatarPreview} alt="Аватар" onError={hideBrokenImage} />}</span><span className="avatar-edit-badge"><Plus size={13} /></span></button><input ref={avatarInput} className="visually-hidden-file" type="file" accept="image/*" onChange={(event) => handleAvatar(event.target.files?.[0])} /><div><p className="modal-overline">МОЙ PULSE</p><h2>{user.name}<span>.</span></h2><span className="profile-email">{user.email}</span></div></div><p className="avatar-hint">Нажмите на аватар, чтобы выбрать фото из галереи</p><div className="profile-form"><label className="input-label">Ваше имя<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="input-label">Родной город<div className="select-wrap"><Navigation size={15} /><select value={city} onChange={(event) => setCity(event.target.value)}><option>Орск</option><option>Москва</option><option>Санкт-Петербург</option><option>Екатеринбург</option><option>Казань</option></select><ChevronDown size={14} /></div></label><label className="input-label">О себе<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={240} placeholder="Коротко о себе" /></label><label className="input-label">Район города<input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} maxLength={120} placeholder="Например, 2-й микрорайон" /></label><button className="setting-toggle" onClick={() => setNotifications((value) => !value)}><span><Bell size={16} /><span><strong>Уведомления рядом</strong><small>Получать важные сигналы в вашем городе</small></span></span><i className={notifications ? 'on' : ''}><b /></i></button></div>{error && <p className="form-error">{error}</p>}<div className="profile-actions">{user.role === 'admin' && <button className="text-action" onClick={onAdminOpen}>Открыть модерацию</button>}<button className="logout-action" onClick={() => { void logout(); onClose() }}><LogOut size={15} /> Выйти</button><button className="primary-action compact" disabled={saving} onClick={() => { void save() }}>{saving ? 'Сохраняем…' : 'Сохранить'} <Check size={15} /></button></div></div></ModalFrame>
  }

function MessagesPanel({ recipient, onClose, onNotify }: { recipient: { id: string; name: string }; onClose: () => void; onNotify: (message: string, tone?: Toast['tone']) => void }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Awaited<ReturnType<typeof fetchDirectMessages>>>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const load = async () => { setLoading(true); try { setMessages(await fetchDirectMessages(recipient.id)) } catch (error) { const kind = apiErrorKind(error); onNotify(kind === 'auth' ? 'Войдите, чтобы читать сообщения' : kind === 'missing-rpc' ? 'Бэкенд не обновлён: примените миграции supabase/migrations' : 'Сообщения пока недоступны. Попробуйте позже.', 'error') } finally { setLoading(false) } }
  useEffect(() => { void load() }, [recipient.id])
  const submit = async () => { const value = body.trim(); if (!value || sending || !user || user.isAnonymous) return; setSending(true); try { const message = await sendDirectMessage(recipient.id, value); setMessages((current) => [...current, message]); setBody('') } catch { onNotify('Не удалось отправить сообщение. Попробуйте позже.', 'error') } finally { setSending(false) } }
  return <motion.aside className="notifications-panel messages-panel glass-panel" initial={{ x: 26, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 26, opacity: 0 }} transition={spring}><div className="panel-header"><div><p className="modal-overline">PULSE / DIRECT</p><h2>{recipient.name}</h2></div><button className="sheet-close" onClick={onClose} aria-label="Закрыть сообщения"><X size={17} /></button></div><div className="messages-list">{loading ? <p className="panel-empty">Загружаем переписку…</p> : messages.length === 0 ? <p className="panel-empty">Начните диалог с автором сигнала.</p> : messages.map((message) => <div className={`message-bubble ${message.senderId === user?.id ? 'outgoing' : 'incoming'}`} key={message.id}>{message.body}</div>)}</div><form className="message-compose" onSubmit={(event) => { event.preventDefault(); void submit() }}><input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Написать сообщение…" maxLength={1000} aria-label="Сообщение" /><button type="submit" disabled={!body.trim() || sending} aria-label="Отправить сообщение"><Send size={15} /></button></form></motion.aside>
}

function AdminPanel({ events, onClose, onNotify }: { events: RadarEvent[]; onClose: () => void; onNotify: (message: string, tone?: Toast['tone']) => void }) {
  const [reports, setReports] = useState<Awaited<ReturnType<typeof fetchOpenReports>>>([])
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    try { setReports(await fetchOpenReports()) } catch (error) { onNotify(apiErrorKind(error) === 'missing-rpc' ? 'Модерация недоступна: примените миграцию 20260821_fix_admin_list_open_reports.sql' : 'Модерация пока недоступна. Попробуйте позже.', 'error') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const moderate = async (eventId: string, status: 'published' | 'hidden' | 'removed') => {
    try { await setEventModerationStatus(eventId, status); onNotify(status === 'published' ? 'Сигнал возвращён на карту' : 'Сигнал скрыт'); await load() } catch (error) { const kind = apiErrorKind(error); onNotify(kind === 'admin' ? 'Только администратор может модерировать сигналы' : kind === 'missing-rpc' ? 'Бэкенд не обновлён: примените миграции supabase/migrations' : 'Не удалось обновить статус сигнала', 'error') }
  }
  return <motion.aside className="notifications-panel admin-panel glass-panel" initial={{ x: 26, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 26, opacity: 0 }} transition={spring}><div className="panel-header"><div><p className="modal-overline">PULSE / MODERATION</p><h2>Модерация</h2></div><button className="sheet-close" onClick={onClose} aria-label="Закрыть модерацию"><X size={17} /></button></div>{loading ? <p className="panel-empty">Загружаем обращения…</p> : reports.length === 0 ? <p className="panel-empty">Открытых обращений нет.</p> : reports.map((report) => { const event = events.find((item) => item.id === report.eventId); return <div className="notification-row" key={report.id}><span className="notification-icon amber"><ShieldCheck size={15} /></span><div><strong>{event?.title ?? 'Сигнал на проверке'}</strong><p>{report.reason}</p><small>{event?.location ?? 'Адрес скрыт'}</small><div className="admin-actions"><button onClick={() => { void moderate(report.eventId, 'hidden') }}>Скрыть</button><button onClick={() => { void moderate(report.eventId, 'removed') }}>Удалить</button><button onClick={() => { void moderate(report.eventId, 'published') }}>Оставить</button></div></div></div> })}</motion.aside>
}

function PulseAiPanel({ events, onClose }: { events: RadarEvent[]; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [question, setQuestion] = useState('')
  const summary = events.length === 0 ? 'На районе сейчас спокойно. Новых сигналов в видимой области пока нет — самое время добавить наблюдение.' : `В видимой области ${events.length} ${events.length === 1 ? 'сигнал' : 'сигналов'}. ${events.filter((event) => event.kind === 'help').length ? 'Есть соседские предложения помощи.' : 'Бартерных предложений пока не видно.'} Последнее обновление — только что.`
  useEffect(() => { setTyped(''); let index = 0; const timer = window.setInterval(() => { index += 1; setTyped(summary.slice(0, index)); if (index >= summary.length) window.clearInterval(timer) }, 18); return () => window.clearInterval(timer) }, [summary])
  return <motion.aside className="ai-panel glass-panel" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: .98 }} transition={spring}><div className="ai-panel-head"><div><span className="ai-kicker"><Bot size={14} /> PULSE AI</span><h2>Что происходит рядом?</h2></div><button className="sheet-close" onClick={onClose} aria-label="Закрыть AI"><X size={17} /></button></div><div className="ai-message"><span className="ai-message-avatar"><Sparkles size={15} /></span><p>{typed}<span className="typing-cursor">▍</span></p></div><div className="ai-suggestions"><button onClick={() => setQuestion('Где сейчас спокойнее?')}>Где спокойнее?</button><button onClick={() => setQuestion('Есть ли помощь рядом?')}>Помощь рядом</button></div><div className="ai-input"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Спросить про район…" onKeyDown={(event) => { if (event.key === 'Enter' && question.trim()) setQuestion('Пока я умею только читать карту — скоро подключу полный AI-ответ.') }} /><button onClick={() => { if (question.trim()) setQuestion('Пока я умею только читать карту — скоро подключу полный AI-ответ.') }} aria-label="Отправить"><Send size={15} /></button></div></motion.aside>
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
