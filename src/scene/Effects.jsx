// Postprocessing only on the high tier: half-res N8AO grounds the white furniture on the
// tiles, plus Neutral tone mapping (keeps product prints colour-true, unlike ACES/AgX) and a
// faint vignette. On lower tiers the renderer tone-maps directly and no composer runs at all.
import { EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useQuality } from '../perf/quality'

export function Effects() {
  const q = useQuality()
  if (!q.effects) return null
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO halfRes aoRadius={0.6} distanceFalloff={0.6} intensity={2.2} quality="medium" color="#1c1a16" />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  )
}
