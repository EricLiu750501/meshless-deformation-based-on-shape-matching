import { CanvasTexture, RepeatWrapping } from 'three'


function createGridTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')!
  
  const cellSize = size / 2  // 設置格子的大小為畫布大小的 1/8

  // 繪製黑白格子
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      context.fillStyle = (x + y) % 2 === 0 ? 'black' : 'white'  // 根據行列位置選擇顏色
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(10, 10)  // 設置圖案的重複次數
  return texture
}


export { createGridTexture }


