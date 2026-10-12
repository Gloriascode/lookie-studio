// Conservatory | Bedroom switcher over the scene. Rooms share one shop: switching keeps the
// shop, its products and the bag, and only changes what's on screen.
import { SCENES } from '../scenes'
import { slotsInScene } from '../slots'
import { useApp } from '../state/appStore'
import { navigateRoom } from './router'

/** Products per room: live ones in the shop, any status in the studio. */
function useRoomCounts(mode) {
  const products = useApp((s) => s.products)
  const counts = {}
  for (const scene of SCENES) {
    const here = new Set(slotsInScene(scene.id).map((s) => s.id))
    counts[scene.id] = products.filter((p) => here.has(p.slot) && (mode === 'create' || p.status === 'succeeded')).length
  }
  return counts
}

export function RoomTabs() {
  const scene = useApp((s) => s.scene)
  const mode = useApp((s) => s.mode)
  const counts = useRoomCounts(mode)
  return (
    <nav className="room-tabs" role="tablist" aria-label="Rooms">
      {SCENES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={scene === s.id}
          className="room-tabs__btn"
          onClick={() => navigateRoom(s.id)}
        >
          {s.label}
          {counts[s.id] > 0 && <span className="room-tabs__count" aria-label={`${counts[s.id]} products`}>{counts[s.id]}</span>}
        </button>
      ))}
    </nav>
  )
}
