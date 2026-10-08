import type { PresetId } from './types'

export function paintSwatch(canvas: HTMLCanvasElement, preset: PresetId) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#1c2420'
  ctx.fillRect(0, 0, w, h)
  if (preset === 'trail') {
    ctx.fillStyle = '#8a6a3e'
    ctx.beginPath()
    ctx.moveTo(4, h - 6)
    ctx.lineTo(w / 2, 8)
    ctx.lineTo(w - 4, h - 6)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#c4a15a'
    ctx.fillRect(w / 2 - 4, 10, 8, h - 18)
  } else if (preset === 'cobble') {
    ctx.fillStyle = '#8d8d8d'
    for (let i = 0; i < 4; i++) ctx.fillRect(6 + i * 14, 10, 12, h - 20)
    ctx.strokeStyle = '#5c5c5c'
    ctx.strokeRect(8, 8, w - 16, h - 16)
  } else if (preset === 'moss') {
    ctx.fillStyle = '#5d7a32'
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#3f5a28'
    ctx.fillRect(10, h / 2 - 3, w - 20, 6)
  } else if (preset === 'sandstone') {
    ctx.fillStyle = '#e2d2a4'
    ctx.fillRect(8, 8, w - 16, 8)
    ctx.fillStyle = '#cbb98a'
    ctx.fillRect(8, 18, w - 16, 8)
    ctx.fillStyle = '#d8c48a'
    ctx.fillRect(12, 28, w - 24, 10)
  } else if (preset === 'adaptive') {
    ctx.fillStyle = '#c4a15a'
    ctx.beginPath()
    ctx.moveTo(8, h / 2)
    ctx.lineTo(w / 2, 6)
    ctx.lineTo(w - 8, h / 2)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#6f8f9a'
    ctx.beginPath()
    ctx.moveTo(8, h / 2)
    ctx.lineTo(w / 2, h - 6)
    ctx.lineTo(w - 8, h / 2)
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.fillStyle = '#8a6238'
    for (let i = 0; i < 5; i++) ctx.fillRect(6, 6 + i * 7, w - 12, 5)
    ctx.strokeStyle = '#d7a15a'
    ctx.strokeRect(4, 4, w - 8, h - 8)
  }
}
