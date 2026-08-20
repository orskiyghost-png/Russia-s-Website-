import { memo, useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import L, { type LatLngExpression } from 'leaflet'
import { Crosshair, MapPin } from 'lucide-react'
import type { EventKind, RadarEvent } from './types'
import { kindConfig } from './data'
import type { Theme } from './theme'

type CityMapProps = {
  center: [number, number]
  events: RadarEvent[]
  selectedId?: string
  theme: Theme
  onSelect: (event: RadarEvent) => void
  onMapClick: (coords: { lat: number; lng: number }) => void
}

function MapViewport({ center }: { center: [number, number] }) {
  const map = useMap()
  const lastCenter = useRef<[number, number]>(center)
  useEffect(() => {
    const [lat, lng] = center
    const [previousLat, previousLng] = lastCenter.current
    if (Math.abs(lat - previousLat) < 0.000001 && Math.abs(lng - previousLng) < 0.000001) return
    lastCenter.current = center
    map.flyTo(center, Math.max(map.getZoom(), 12), { duration: 0.72, easeLinearity: 0.22 })
  }, [center, map])
  return null
}

function MapClickCapture({ onMapClick }: { onMapClick: CityMapProps['onMapClick'] }) {
  useMapEvents({ click: (event) => onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng }) })
  return null
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function markerIcon(event: RadarEvent, selected: boolean) {
  const { color } = kindConfig[event.kind]
  const safeAvatar = event.avatarUrl ? escapeAttribute(event.avatarUrl) : ''
  const avatar = safeAvatar
    ? `<img class="pulse-marker-avatar" src="${safeAvatar}" alt="" loading="lazy" />`
    : `<span class="pulse-marker-fallback">${escapeAttribute(initials(event.userName))}</span>`
  return L.divIcon({
    className: 'pulse-leaflet-marker-wrapper',
    html: `<div class="pulse-leaflet-marker marker-${color} ${selected ? 'is-selected' : ''}" title="${escapeAttribute(event.title)}"><span class="pulse-marker-ring"></span><span class="pulse-marker-pin">${avatar}</span></div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -26],
  })
}

const EventMarker = memo(function EventMarker({ event, selectedId, onSelect }: { event: RadarEvent; selectedId?: string; onSelect: (event: RadarEvent) => void }) {
  const selected = event.id === selectedId
  const icon = useMemo(() => markerIcon(event, selected), [event, selected])
  const handlers = useMemo(() => ({ click: () => onSelect(event) }), [event, onSelect])
  return <Marker position={[event.lat, event.lng]} icon={icon} eventHandlers={handlers}><Popup closeButton={false} className="pulse-popup"><strong>{event.title}</strong><span>{event.userName} · {event.location}</span></Popup></Marker>
})

export function CityMap({ center, events, selectedId, theme, onSelect, onMapClick }: CityMapProps) {
  const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const attribution = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
  return <MapContainer center={center as LatLngExpression} zoom={12} minZoom={3} maxZoom={19} zoomControl={false} scrollWheelZoom preferCanvas className="real-map"><TileLayer attribution={attribution} url={tileUrl} updateWhenIdle updateWhenZooming={false} keepBuffer={2} /><ZoomControl position="bottomright" /><MapViewport center={center} /><MapClickCapture onMapClick={onMapClick} />{events.map((event) => <EventMarker key={event.id} event={event} selectedId={selectedId} onSelect={onSelect} />)}</MapContainer>
}

export function LocateMeButton({ onLocated, onError }: { onLocated: (center: [number, number]) => void; onError: (message: string) => void }) {
  const handleLocate = () => { if (!navigator.geolocation) { onError('Геолокация не поддерживается этим браузером'); return } navigator.geolocation.getCurrentPosition(({ coords }) => onLocated([coords.latitude, coords.longitude]), () => onError('Разрешите доступ к геолокации в браузере'), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }) }
  return <button className="map-floating-control" onClick={handleLocate} title="Моё местоположение" aria-label="Моё местоположение"><Crosshair size={17} /></button>
}

export function MapClickHint({ onClick }: { onClick: () => void }) { return <button className="map-click-hint" onClick={onClick}><MapPin size={14} /> Кликните по карте, чтобы добавить событие</button> }
