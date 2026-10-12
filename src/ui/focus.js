// Select a product slot from the UI. The 3D side reacts to appStore.selectedSlot (close-up via
// tourStore.focus); if nothing has taken the camera a frame later, fall back to the tour stop
// that frames the slot. A slot in another room switches rooms first; the room frames it as
// soon as it has streamed in.
import { appStore } from '../state/appStore'
import { SLOT_BY_ID } from '../slots'
import { stopsFor } from '../tour/stops'
import { tourStore } from '../tour/tourStore'
import { navigateRoom } from './router'

export function selectSlot(slotId) {
  const slot = SLOT_BY_ID[slotId]
  if (slot && slot.scene !== appStore.get().scene) navigateRoom(slot.scene)
  const s = appStore.get()
  appStore.set({
    selectedSlot: slotId,
    preview: s.preview && s.preview.slot !== slotId ? null : s.preview,
  })
  if (!slot) return
  requestAnimationFrame(() => {
    if (tourStore.focused || tourStore.pendingJump || appStore.get().selectedSlot !== slotId) return
    const index = stopsFor(slot.scene).findIndex((st) => st.id === slot.stop)
    if (index >= 0 && index !== tourStore.active) tourStore.jumpTo(index)
  })
}

export function clearSelection() {
  appStore.set({ selectedSlot: null, preview: null })
}
