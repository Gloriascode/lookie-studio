// The conservatory room: the glass garden, its lawn, grass, flowers and trees, outdoor light.
// Code-split (App lazy-loads each room), so the foliage assets only load for this room.
import { Suspense } from 'react'
import { GlassGarden } from './GlassGarden'
import { Lighting } from './Lighting'
import { Ground } from './Ground'
import { Grass } from './Grass'
import { Flowers } from './Flowers'
import { Trees } from './Trees'

export default function GardenWorld() {
  return (
    <>
      <Suspense fallback={null}>
        <Lighting />
        <GlassGarden />
        <Ground />
      </Suspense>
      {/* Foliage streams in after the building; it suspends on its own boundary. */}
      <Suspense fallback={null}>
        <Grass />
        <Flowers />
      </Suspense>
      <Trees />
    </>
  )
}
