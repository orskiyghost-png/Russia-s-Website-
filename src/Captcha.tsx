import { useEffect, useRef, useState } from 'react'
import { useTheme } from './theme'

type TurnstileApi = { render: (element: HTMLElement, options: { sitekey: string; theme: 'light' | 'dark'; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string; reset: (widgetId?: string) => void }
type HCaptchaApi = { render: (element: HTMLElement, options: { sitekey: string; theme: 'light' | 'dark'; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string }

declare global {
  interface Window { turnstile?: TurnstileApi; hcaptcha?: HCaptchaApi; __pulseTurnstilePromise?: Promise<void>; __pulseHcaptchaPromise?: Promise<void> }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const HCAPTCHA_SCRIPT = 'https://js.hcaptcha.com/1/api.js?render=explicit'

function captchaSiteKey() { return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim() }
function hcaptchaSiteKey() { return String(import.meta.env.VITE_HCAPTCHA_SITE_KEY ?? '').trim() }

function loadScript(src: string, cacheKey: '__pulseTurnstilePromise' | '__pulseHcaptchaPromise') {
  if (window[cacheKey]) return window[cacheKey]
  window[cacheKey] = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('captcha-load')), { once: true }); return }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('captcha-load'))
    document.head.appendChild(script)
  })
  return window[cacheKey]
}

const loadTurnstile = () => loadScript(TURNSTILE_SCRIPT, '__pulseTurnstilePromise')
const loadHcaptcha = () => loadScript(HCAPTCHA_SCRIPT, '__pulseHcaptchaPromise')

const CALM_MESSAGE = 'Проверка не загрузилась в вашей сети. Если вход не проходит, попробуйте ещё раз.'

export function Captcha({ onToken, onError }: { onToken: (token: string) => void; onError?: (message: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [retry, setRetry] = useState(0)
  const siteKey = captchaSiteKey()
  const hKey = hcaptchaSiteKey()
  // hCaptcha имеет приоритет: если задан его site key, используем его (доступен в большем числе регионов).
  const provider: 'hcaptcha' | 'turnstile' = hKey ? 'hcaptcha' : 'turnstile'
  const key = provider === 'hcaptcha' ? hKey : siteKey
  const { theme } = useTheme()

  useEffect(() => {
    if (!key || !hostRef.current) return
    let cancelled = false
    let retryTimer: number | undefined
    hostRef.current.replaceChildren()

    const onWidgetError = () => {
      onToken('')
      // Автоматическая попытка восстановления, затем понятное сообщение (без бесконечного цикла).
      if (retry < 2) {
        retryTimer = window.setTimeout(() => setRetry((value) => value + 1), 1600)
      } else {
        // Убираем виджет, чтобы скрыть встроенную ошибку провайдера, и оставляем спокойную заметку.
        hostRef.current?.replaceChildren()
        onError?.(CALM_MESSAGE)
      }
    }

    const load = provider === 'hcaptcha' ? loadHcaptcha : loadTurnstile
    void load().then(() => {
      if (cancelled || !hostRef.current) return
      try {
        if (provider === 'hcaptcha' && window.hcaptcha) {
          window.hcaptcha.render(hostRef.current, {
            sitekey: key,
            theme,
            callback: onToken,
            'expired-callback': () => onToken(''),
            'error-callback': onWidgetError,
          })
        } else if (window.turnstile) {
          window.turnstile.render(hostRef.current, {
            sitekey: key,
            theme,
            callback: onToken,
            'expired-callback': () => onToken(''),
            'error-callback': onWidgetError,
          })
        }
      } catch {
        onToken('')
        onError?.(CALM_MESSAGE)
      }
    }).catch(() => onError?.(CALM_MESSAGE))

    return () => { cancelled = true; window.clearTimeout(retryTimer) }
  }, [key, onError, onToken, provider, retry, theme])

  if (!key) return <p className="captcha-missing">Для отправки формы нужно настроить ключ CAPTCHA (`VITE_TURNSTILE_SITE_KEY` или `VITE_HCAPTCHA_SITE_KEY`).</p>
  return <div ref={hostRef} className="captcha-widget" aria-label="Проверка CAPTCHA" />
}
