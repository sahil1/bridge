// Renders the app icon (build/icon.png; electron-builder makes the macOS, Windows and Linux formats
// from it) and the web app's home-screen icons.
//   public/icon.svg  the full app icon: a rounded tile with Apple's standard margin and shadow
//                    already drawn in, so it's rendered edge to edge, not shrunk again.
//   public/mark.svg  the tile alone, for home-screen icons, which should fill their square.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const PUB = path.join(__dirname, '..', 'public')
const BUILD = path.join(__dirname, 'build')
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8')

// On Linux the icons are drawn in software: a build machine's virtual display (xvfb) can't always
// start Chromium's graphics, and the capture then fails ("UnknownVizError").
if (process.platform === 'linux') app.disableHardwareAcceleration()

async function render(win, svg, size, bg = 'transparent') {
  const html = `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;background:${bg}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 120))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return img.resize({ width: size, height: size }).toPNG()
}

app.whenReady().then(async () => {
  fs.mkdirSync(BUILD, { recursive: true })
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  win.webContents.setZoomFactor(1)
  fs.writeFileSync(path.join(BUILD, 'icon.png'), await render(win, read('icon.svg'), 1024))
  // Home-screen icons are square; the phone rounds the corners itself.
  fs.writeFileSync(path.join(PUB, 'apple-touch-icon.png'), await render(win, read('mark.svg'), 180, '#0b0d11'))
  fs.writeFileSync(path.join(PUB, 'icon-512.png'), await render(win, read('mark.svg'), 512, '#0b0d11'))
  // The phone apps (mobile/): square too, rounded or masked by the phone.
  const MOBILE = path.join(__dirname, '..', 'mobile')
  fs.writeFileSync(path.join(MOBILE, 'ios', 'BridgeAI', 'Assets.xcassets', 'AppIcon.appiconset', 'icon-1024.png'), await render(win, read('mark.svg'), 1024, '#0b0d11'))
  const RES = path.join(MOBILE, 'android', 'app', 'src', 'main', 'res')
  for (const [dpi, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    fs.mkdirSync(path.join(RES, `mipmap-${dpi}`), { recursive: true })
    fs.writeFileSync(path.join(RES, `mipmap-${dpi}`, 'ic_launcher.png'), await render(win, read('mark.svg'), 48 * scale, '#0b0d11'))
    fs.writeFileSync(path.join(RES, `mipmap-${dpi}`, 'ic_launcher_foreground.png'), await render(win, read('mark.svg'), 108 * scale, '#0b0d11'))
  }
  app.quit()
}).catch((e) => {
  // Fail rather than wait: an error here left Electron running with nothing to do, and the build
  // waited on it for hours.
  console.error(`render-icons: ${e?.stack || e}`)
  app.exit(1)
})
