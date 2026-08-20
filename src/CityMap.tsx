import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents, ZoomControl, Popup } from 'react-leaflet'
import L, { type LatLngExpression } from 'leaflet'
import { Crosshair, MapPin } from 'lucide-react'
import type { EventKind, RadarEvent } from './types'
import { kindConfig } from './data'

type CityMapProps = {
  center: [number, number]
  events: RadarEvent[]
  selectedId?: string
  onSelect: (event: RadarEvent) => void
  onMapClick: (coords: { lat: number; lng: number }) => void
}

function MapViewport({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo(center, Math.max(map.getZoom(), 12), { duration: 1.35 })
  }, [center, map])
  return null
}

function MapClickCapture({ onMapClick }: { onMapClick: CityMapProps['onMapClick'] }) {
  useMapEvents({ click: (event) => onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng }) })
  return null
}

function markerIcon(kind: EventKind, selected: boolean) {
  const { color } = kindConfig[kind]
  return L.divIcon({
    className: 'pulse-leaflet-marker-wrapper',
    html: `<div class="pulse-leaflet-marker marker-${color} ${selected ? 'is-selected' : ''}"><span class="pulse-marker-ring"></span><span class="pulse-marker-pin">${kind === 'city' ? '!' : kind === 'vibe' ? '✦' : kind === 'street' ? '↗' : '＋'}</span></div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -22],
  })
}

function EventMarker({ event, selectedId, onSelect }: { event: RadarEvent; selectedId?: string; onSelect: (event: RadarEvent) => void }) {
  const icon = useMemo(() => markerIcon(event.kind, event.id === selectedId), [event.id, event.kind, selectedId])
  return <Marker position={[event.lat, event.lng]} icon={icon} eventHandlers={{ click: () => onSelect(event) }}>
    <Popup closeButton={false} className="pulse-popup"><strong>{event.title}</strong><span>{event.location}</span></Popup>
  </Marker>
}

export function CityMap({ center, events, selectedId, onSelect, onMapClick }: CityMapProps) {
  return <MapContainer center={center as LatLngExpression} zoom={12} minZoom={3} maxZoom={19} zoomControl={false} scrollWheelZoom className="real-map">
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <ZoomControl position="bottomright" />
    <MapViewport center={center} />
    <MapClickCapture onMapClick={onMapClick} />
    {events.map((event) => <EventMarker key={event.id} event={event} selectedId={selectedId} onSelect={onSelect} />)}
  </MapContainer>
}

export function LocateMeButton({ onLocated, onError }: { onLocated: (center: [number, number]) => void; onError: (message: string) => void }) {
  const handleLocate = () => {
    if (!navigator.geolocation) {
      onError('Геолокация не поддерживается этим браузером')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => onLocated([coords.latitude, coords.longitude]),
      () => onError('Разрешите доступ к геолокации в браузере'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    )
  }
  return <button className="map-floating-control" onClick={handleLocate} title="Моё местоположение" aria-label="Моё местоположение"><Crosshair size={17} /></button>
}

export function MapClickHint({ onClick }: { onClick: () => void }) {
  return <button className="map-click-hint" onClick={onClick}><MapPin size={14} /> Кликните по карте, чтобы добавить событие</button>
}
