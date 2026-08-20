import type { ComponentType } from 'react'

export type EventKind = 'city' | 'vibe' | 'street' | 'help'
export type Layer = 'all' | EventKind
export type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export type RadarEvent = {
  id: string
  kind: EventKind
  category: string
  title: string
  description: string
  location: string
  lat: number
  lng: number
  createdAt: number
  userName: string
  reactions: number
  comments: number
}

export type AuthUser = {
  id: string
  email: string
  name: string
  city: string
  notifications: boolean
  createdAt: number
}
