import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'
type ThemeContextValue = { theme: Theme; toggleTheme: () => void }
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function initialTheme(): Theme {
  try {
    // v2 ключ: сбрасывает старые сохранённые значения и возвращает тёмную тему по умолчанию (dark-first).
    const saved = window.localStorage.getItem('pulse-theme-v2')
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* storage may be disabled */
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === 'dark' ? '#05070c' : '#f4f6f9')
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    applyTheme(theme)
    try {
      window.localStorage.setItem('pulse-theme-v2', theme)
    } catch {
      /* storage may be disabled */
    }
  }, [theme])
  const value = useMemo(() => ({ theme, toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')) }), [])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
