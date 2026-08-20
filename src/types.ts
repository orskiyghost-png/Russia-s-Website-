import type { ComponentType } from 'react'

export type EventKind = 'city' | 'vibe' | 'street' | 'help'
export type Layer = 'all' | 'roads' | 'utilities' | 'social' | 'incidents'
export type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export type EventComment = {
  id: string
  userName: string
  avatarUrl?: string | null
  body: string
  createdAt: number
}

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
  avatarUrl?: string | null
  reactions: number
  comments: number
  likedByMe?: boolean
  commentsList?: EventComment[]
}

export type AuthUser = {
  id: string
  email: string
  name: string
  city: string
  notifications: boolean
  avatarUrl?: string | null
  createdAt: number
  isAnonymous: boolean
  authProvider: 'email' | 'anonymous' | 'unknown'
}
