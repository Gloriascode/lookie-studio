import { Suspense, lazy, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { WindClock } from './scene/wind'
import { ScrollCameraDirector } from './tour/ScrollCameraDirector'
import { StopCaption, SwipeHint, TourNav } from './tour/TourNav'
import { AdaptiveQuality } from './perf/AdaptiveQuality'
import { quality, useQuality } from './perf/quality'
import { appStore, useApp } from './state/appStore'
import { Link, useRoute } from './ui/router'
import { Landing } from './ui/Landing'
import { Studio } from './ui/Studio'
import { ShopView } from './ui/Shop'
import { HoverTip } from './ui/HoverTip'
import { clearSelection } from './ui/focus'
import { RoomTabs } from './ui/RoomTabs'

const dev = new URLSearchParams(location.search).has('dev')

// Each room is its own chunk; only the room on screen (and its GLB) is fetched.
const WORLDS = {
  garden: lazy(() => import('./scene/GardenWorld')),
  bedroom: lazy(() => import('./scene/BedroomWorld')),
}

function World() {
  const scene = useApp((s) => s.scene)
  const Room = WORLDS[scene] ?? WORLDS.garden
  return (
    <Suspense fallback={null}>
      <Room key={scene} />
    </Suspense>
  )
}
// Postprocessing (~100 kB gz) is only fetched once a device reaches the high tier.
const Effects = lazy(() => import('./scene/Effects').then((m) => ({ default: m.Effects })))

function HighTierEffects() {
  const q = useQuality()
  if (!q.effects) return null
  return (
    <Suspense fallback={null}>
      <Effects />
    </Suspense>
  )
}
const DevTools = dev ? lazy(() => import('./DevTools').then((m) => ({ default: m.DevTools }))) : null

function LoadingVeil() {
  const { active, progress } = useProgress()
  const done = !active && progress >= 100
  return (
    <div className={`veil${done ? ' veil--done' : ''}`} aria-hidden={done}>
      <div className="veil__mark">Lookie Studio</div>
      <div className="veil__bar">
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
    </div>
  )
}

function Overlay({ route }) {
  if (route.name === 'studio') return <Studio />
  if (route.name === 'shop') return <ShopView key={route.slug} slug={route.slug} />
  return <Landing />
}

export default function App() {
  const [orbit, setOrbit] = useState(false)
  const route = useRoute()
  const creator = useApp((s) => s.creator)
  const selectedSlot = useApp((s) => s.selectedSlot)

  // Escape closes the slot panel / product card and drops any unsaved preview.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && clearSelection()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The scene clears selectedSlot itself (scroll away, click on empty space); drop the
  // unsaved preview with it so the pattern doesn't linger on a product nobody is editing.
  useEffect(() => {
    if (!selectedSlot && appStore.get().preview) appStore.set({ preview: null })
  }, [selectedSlot])

  // Layout hints for CSS: which overlay is up, so captions/nav can step aside.
  const panel = (route.name === 'studio' && creator) || (route.name === 'shop' && selectedSlot)
  const cls = ['app', `app--${route.name}`, panel && 'app--panel', route.name === 'studio' && !creator && 'app--modal'].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <Canvas
        // Wind keeps foliage moving, so render continuously; quality tiers bound the cost.
        frameloop="always"
        dpr={[1, Math.min(window.devicePixelRatio, quality.settings.dpr)]}
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ fov: quality.isMobile ? 58 : 48, near: 0.1, far: 400, position: [13, 7.5, 18] }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          // Neutral keeps prints colour-true; ACES/AgX would shift designers' palettes.
          toneMapping: THREE.NeutralToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <World />
        <WindClock />
        <ScrollCameraDirector blocked={orbit} />
        <AdaptiveQuality />
        <HighTierEffects />
        {DevTools && (
          <Suspense fallback={null}>
            <DevTools onOrbitChange={setOrbit} />
          </Suspense>
        )}
      </Canvas>

      <Link to="/" className="brand">
        Lookie Studio
      </Link>
      <StopCaption />
      <TourNav />
      <SwipeHint />
      <Overlay route={route} />
      {(route.name === 'shop' || (route.name === 'studio' && creator)) && <RoomTabs />}
      <HoverTip />
      <LoadingVeil />
    </div>
  )
}
