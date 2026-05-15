export function playVoiceCue(kind: 'hold' | 'handsfree') {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextClass) return

  const ctx = new AudioContextClass()
  const now = ctx.currentTime
  const gain = ctx.createGain()
  gain.connect(ctx.destination)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(kind === 'hold' ? 0.08 : 0.06, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'hold' ? 0.22 : 0.34))

  const notes = kind === 'hold'
    ? [740, 980]
    : [520, 700, 1040]

  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + index * 0.055)
    osc.connect(gain)
    osc.start(now + index * 0.055)
    osc.stop(now + index * 0.055 + 0.11)
  })

  window.setTimeout(() => void ctx.close(), kind === 'hold' ? 300 : 460)
}
