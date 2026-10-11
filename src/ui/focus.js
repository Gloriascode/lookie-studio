// Select a product slot from the UI. The 3D side reacts to appStore.selectedSlot (close-up via
// tourStore.focus); if nothing has taken the camera a frame later, fall back to the tour stop
// that frames the slot.
import { appStore } from '../state/appStore'
import { SLOT_BY_ID } from '../slots'
import { STOPS } from '../tour/stops'
import { tourStore } from '../tour/tourStore'

export function selectSlot(slotId) {
  const s = appStore.get()
  appStore.set({
    selectedSlot: slotId,
    preview: s.preview && s.preview.slot !== slotId ? null : s.preview,
  })
  const slot = SLOT_BY_ID[slotId]
  if (!slot) return
  requestAnimationFrame(() => {
    if (tourStore.focused || tourStore.pendingJump || appStore.get().selectedSlot !== slotId) return
    const index = STOPS.findIndex((st) => st.id === slot.stop)
    if (index >= 0 && index !== tourStore.active) tourStore.jumpTo(index)
  })
}

export function clearSelection() {
  appStore.set({ selectedSlot: null, preview: null })
}
