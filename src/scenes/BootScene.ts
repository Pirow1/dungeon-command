import Phaser from 'phaser'
import { SHEET, TILE_PX } from '../spritemap'

// Loads the packed sheet and extracts per-frame data-URL portraits for the DOM
// HUD & chatter log, then hands off to GameScene.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot')
  }

  preload(): void {
    this.load.spritesheet(SHEET, '/assets/tiny_dungeon.png', {
      frameWidth: TILE_PX,
      frameHeight: TILE_PX,
    })
  }

  create(): void {
    // Portraits: draw frames onto a canvas, upscaled without smoothing.
    const tex = this.textures.get(SHEET)
    const src = tex.getSourceImage() as HTMLImageElement
    const cols = Math.floor(src.width / TILE_PX)
    const portraits: Record<number, string> = {}
    const canvas = document.createElement('canvas')
    canvas.width = TILE_PX * 4
    canvas.height = TILE_PX * 4
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const want = new Set<number>()
    for (let i = 0; i < cols * Math.floor(src.height / TILE_PX); i++) want.add(i)
    for (const f of want) {
      const fx = (f % cols) * TILE_PX
      const fy = Math.floor(f / cols) * TILE_PX
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(src, fx, fy, TILE_PX, TILE_PX, 0, 0, canvas.width, canvas.height)
      portraits[f] = canvas.toDataURL()
    }
    this.registry.set('portraits', portraits)
    this.scene.start('game')
  }
}
