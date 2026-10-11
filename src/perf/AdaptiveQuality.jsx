// Watches the frame rate and moves the quality tier (and DPR) up or down.
// PerformanceMonitor averages over a few seconds, so a single hitch doesn't flip anything,
// and after enough flip-flops it gives up and stays at the lower tier.
import { PerformanceMonitor } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { quality, useQuality } from './quality'

export function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr)
  const q = useQuality()

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio, q.dpr))
  }, [q.dpr, setDpr])

  return (
    <PerformanceMonitor
      bounds={(refreshRate) => (refreshRate > 90 ? [55, 85] : [44, 57])}
      flipflops={3}
      onDecline={() => quality.set(quality.tier - 1)}
      onIncline={() => quality.set(quality.tier + 1)}
      onFallback={() => quality.set(0)}
    />
  )
}
