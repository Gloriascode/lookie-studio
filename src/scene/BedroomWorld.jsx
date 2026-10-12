// The bedroom: the room itself, daylight through its windows, and a few trees in the garden
// outside them (they sit outside the sun's shadow frustum, so they don't cast).
import { Suspense } from 'react'
import { Bedroom } from './Bedroom'
import { BedroomLighting } from './BedroomLighting'
import { Trees } from './Trees'

// The windows look out along -X.
const OUTSIDE = [
  ['bush', -3.0, 2.2], ['bush2', -3.2, 0.2], ['bush', -3.1, -1.6],
  ['oak', -8.5, 3.5], ['aspen', -7.5, -2.5], ['ash', -12.5, 0.5], ['oak', -11, -7], ['aspen', -10, 8],
  ['pine', -22, -10], ['pine', -24, 6],
]

export default function BedroomWorld() {
  return (
    <>
      <Suspense fallback={null}>
        <BedroomLighting />
        <Bedroom />
      </Suspense>
      <Trees planting={OUTSIDE} castShadow={false} />
    </>
  )
}
