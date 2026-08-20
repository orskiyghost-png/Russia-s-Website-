import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import L, { type LatLngExpression } from 'leaflet'
import { Crosshair } from 'lucide-react'
import type { RadarEvent } from './types'
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

function MapLayoutSync() {
  const map = useMap()
  useEffect(() => {
    const invalidate = () => map.invalidateSize({ pan: false, animate: false })
    const frame = window.requestAnimationFrame(invalidate)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => window.requestAnimationFrame(invalidate)) : null
    observer?.observe(map.getContainer())
    window.addEventListener('resize', invalidate, { passive: true })
    window.addEventListener('orientationchange', invalidate, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('orientationchange', invalidate)
    }
  }, [map])
  return null
}

function MapViewport({ center }: { center: [number, number] }) {
  const map = useMap()
  const lastCenter = useRef<[number, number]>(center)
  useEffect(() => {
    const [lat, lng] = center
    const [previousLat, previousLng] = lastCenter.current
    if (Math.abs(lat - previousLat) < 0.000001 && Math.abs(lng - previousLng) < 0.000001) return
    lastCenter.current = center
    map.flyTo(center, 13, { duration: 0.72, easeLinearity: 0.22 })
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
  const size = selected ? 44 : 34
  return L.divIcon({
    className: 'pulse-leaflet-marker-wrapper',
    html: `<div class="pulse-leaflet-marker marker-${color} ${selected ? 'is-selected' : ''}" title="${escapeAttribute(event.title)}"><span class="pulse-marker-pin">${avatar}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

function clusterIcon(count: number) {
  const size = 44
  return L.divIcon({
    className: 'pulse-leaflet-cluster-wrapper',
    html: `<div class="pulse-leaflet-cluster" aria-label="${count} сигналов рядом"><span>${count}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const EventMarker = memo(function EventMarker({ event, selectedId, onSelect }: { event: RadarEvent; selectedId?: string; onSelect: (event: RadarEvent) => void }) {
  const selected = event.id === selectedId
  const icon = useMemo(() => markerIcon(event, selected), [event, selected])
  const handlers = useMemo(() => ({ click: () => onSelect(event) }), [event, onSelect])
  return <Marker position={[event.lat, event.lng]} icon={icon} eventHandlers={handlers}><Popup closeButton={false} className="pulse-popup"><strong>{event.title}</strong><span>{event.userName} · {event.location}</span></Popup></Marker>
})

function ClusterMarker({ events, onSelect }: { events: RadarEvent[]; onSelect: (event: RadarEvent) => void }) {
  const map = useMap()
  const center = useMemo(() => {
    const totals = events.reduce((result, event) => ({ lat: result.lat + event.lat, lng: result.lng + event.lng }), { lat: 0, lng: 0 })
    return [totals.lat / events.length, totals.lng / events.length] as [number, number]
  }, [events])
  const icon = useMemo(() => clusterIcon(events.length), [events.length])
  const handlers = useMemo(() => ({ click: () => map.flyTo(center, Math.min(18, map.getZoom() + 2), { duration: 0.55 }) }), [center, map])
  return <Marker position={center} icon={icon} eventHandlers={handlers}><Popup closeButton={false} className="pulse-popup"><strong>{events.length} сигналов рядом</strong><span>Приблизьте карту, чтобы открыть отдельные сигналы</span></Popup></Marker>
}

function ClusteredMarkers({ events, selectedId, onSelect }: { events: RadarEvent[]; selectedId?: string; onSelect: (event: RadarEvent) => void }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const cellSize = zoom >= 16 ? 0.0005 : zoom >= 14 ? 0.0015 : 0.004
  const groups = useMemo(() => {
    const buckets = new Map<string, RadarEvent[]>()
    for (const event of events) {
      if (event.id === selectedId) {
        buckets.set(`selected:${event.id}`, [event])
        continue
      }
      const key = `${Math.round(event.lat / cellSize)}:${Math.round(event.lng / cellSize)}`
      buckets.set(key, [...(buckets.get(key) ?? []), event])
    }
    return Array.from(buckets.values())
  }, [cellSize, events, selectedId])
  return <>{groups.map((group) => group.length > 1 ? <ClusterMarker key={group.map((event) => event.id).join('|')} events={group} onSelect={onSelect} /> : <EventMarker key={group[0].id} event={group[0]} selectedId={selectedId} onSelect={onSelect} />)}</>
}

export function CityMap({ center, events, selectedId, theme, onSelect, onMapClick }: CityMapProps) {
  const tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  return <MapContainer center={center as LatLngExpression} zoom={12} minZoom={3} maxZoom={19} zoomControl={false} attributionControl={false} scrollWheelZoom preferCanvas className="real-map"><TileLayer url={tileUrl} updateWhenIdle updateWhenZooming={false} keepBuffer={2} crossOrigin /><ZoomControl position="bottomright" /><MapLayoutSync /><MapViewport center={center} /><MapClickCapture onMapClick={onMapClick} /><ClusteredMarkers events={events} selectedId={selectedId} onSelect={onSelect} /></MapContainer>
}

export function LocateMeButton({ onLocated, onError }: { onLocated: (center: [number, number]) => void; onError: (message: string) => void }) {
  const handleLocate = () => { if (!navigator.geolocation) { onError('Геолокация не поддерживается этим браузером'); return } navigator.geolocation.getCurrentPosition(({ coords }) => onLocated([coords.latitude, coords.longitude]), () => onError('Разрешите доступ к геолокации в браузере'), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }) }
  return <button className="map-floating-control" onClick={handleLocate} title="Моё местоположение" aria-label="Моё местоположение"><Crosshair size={17} /></button>
}
