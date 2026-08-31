import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const source = join(appRoot, 'resources/deepseek-harness.svg')
const output = join(appRoot, 'resources/deepseek-harness.icns')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-icon-'))
const iconset = join(temporaryRoot, 'deepseek-harness.iconset')

const representations = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

try {
  if (process.platform !== 'darwin') {
    throw new Error('Desktop icon generation requires macOS iconutil')
  }
  mkdirSync(iconset)
  for (const [name, size] of representations) {
    await sharp(source, { density: 288 })
      .resize(size, size, { fit: 'fill' })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toFile(join(iconset, name))
  }
  mkdirSync(dirname(output), { recursive: true })
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', output], { stdio: 'inherit' })
  console.log(output)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
