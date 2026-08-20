import { useEffect, useRef } from 'react'

type TurnstileWidget = { reset: (widgetId?: string) => void }
type TurnstileApi = { render: (element: HTMLElement, options: { sitekey: string; theme: 'light' | 'dark'; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string; reset: (widgetId?: string) => void }

declare global {
  interface Window { turnstile?: TurnstileApi; __pulseTurnstilePromise?: Promise<void> }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (window.__pulseTurnstilePromise) return window.__pulseTurnstilePromise
  window.__pulseTurnstilePromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`)
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('turnstile-load')), { once: true }); return }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('turnstile-load'))
    document.head.appendChild(script)
  })
  return window.__pulseTurnstilePromise
}

export function captchaSiteKey() {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
}

export function Captcha({ onToken, onError }: { onToken: (token: string) => void; onError?: (message: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widgetRef = useRef<string | null>(null)
  const siteKey = captchaSiteKey()

  useEffect(() => {
    if (!siteKey || !hostRef.current) return
    let cancelled = false
    void loadTurnstile().then(() => {
      if (cancelled || !hostRef.current || !window.turnstile) return
      widgetRef.current = window.turnstile.render(hostRef.current, {
        sitekey: siteKey,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => { onToken(''); onError?.('CAPTCHA временно недоступна. Обновите проверку.') },
      })
    }).catch(() => onError?.('Не удалось загрузить CAPTCHA. Проверьте подключение.'))
    return () => { cancelled = true; widgetRef.current = null }
  }, [onError, onToken, siteKey])

  if (!siteKey) return <p className="captcha-missing">Для отправки формы нужно настроить `VITE_TURNSTILE_SITE_KEY`.</p>
  return <div ref={hostRef} className="captcha-widget" aria-label="Проверка CAPTCHA" />
}
