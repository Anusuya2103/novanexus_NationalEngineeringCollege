const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9444
const ROOT = path.join(__dirname, '..', '..')
const TEST = process.argv.includes('--test')
const TAIL = process.argv.includes('--tail')
const CLOSING = process.argv.includes('--closing')
const OUTPUT = TEST
  ? path.join(ROOT, '.tmp_video', `browser_capture_probe_${Date.now()}.mp4`)
  : CLOSING
    ? path.join(ROOT, '.tmp_video', `HealthTwin_demo_closing_${Date.now()}_raw.mp4`)
    : TAIL
    ? path.join(ROOT, '.tmp_video', `HealthTwin_demo_tail_${Date.now()}_raw.mp4`)
    : path.join(ROOT, '.tmp_video', 'HealthTwin_demo_raw.mp4')
const TEST_STEPS = [
  { url: '/', seconds: 4 },
  { url: '/predict', seconds: 4 },
  { url: '/simulator', seconds: 4 },
]
const DEMO_STEPS = [
  { url: '/', seconds: 50, scrolls: [0, 0.28, 0.62] },
  { url: '/', seconds: 130, scrolls: [0.12, 0.36, 0.65, 0.9] },
  { url: '/', seconds: 70, actions: ['time', 'play', 'alerts'] },
  { url: '/profile', seconds: 90, scrolls: [0, 0.36, 0.7] },
  { url: '/twin', seconds: 105, scrolls: [0, 0.32, 0.68] },
  { url: '/predict', seconds: 130, scrolls: [0, 0.3, 0.62, 0.9] },
  { url: '/simulator', seconds: 160, actions: ['preset', 'custom'], scrolls: [0.35, 0.72] },
  { url: '/reports', seconds: 120, actions: ['horizons'], scrolls: [0.3, 0.64, 0.9] },
  { url: '/settings', seconds: 55, scrolls: [0, 0.6] },
  { url: '/', seconds: 50, scrolls: [0.15, 0.75] },
]
const TAIL_STEPS = [
  { url: '/reports', seconds: 118, scrolls: [0.5, 0.9] },
  { url: '/settings', seconds: 60, scrolls: [0.15, 0.72] },
  { url: '/', seconds: 70, scrolls: [0.15, 0.75] },
]
const CLOSING_STEPS = [
  { url: '/', seconds: 52, scrolls: [0.2, 0.72] },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  if (!fs.existsSync(EDGE)) throw new Error(`Edge not found: ${EDGE}`)
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  if (fs.existsSync(OUTPUT)) throw new Error(`Refusing to overwrite ${OUTPUT}`)

  const profile = path.join(os.tmpdir(), `healthtwin-demo-${Date.now()}`)
  const browser = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' })

  let ws
  let encoder
  let latestFrame
  let frameTimer
  try {
    let version
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
        break
      } catch { await sleep(250) }
    }
    if (!version) throw new Error('Edge DevTools endpoint did not start')

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })

    let commandId = 0
    const pending = new Map()
    let frames = 0
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      }
      if (message.method === 'Page.screencastFrame') {
        frames += 1
        latestFrame = Buffer.from(message.params.data, 'base64')
        send('Page.screencastFrameAck', { sessionId: message.params.sessionId }).catch(() => {})
      }
    }

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++commandId
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            reject(new Error(`Timed out: ${method}`))
          }
        }, 15000)
      })
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
    })
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const install = () => { if (document.getElementById('__demo_cursor')) return; const cursor = document.createElement('div'); cursor.id = '__demo_cursor'; cursor.style.cssText = 'position:fixed;left:0;top:0;width:18px;height:18px;border:2px solid #fff;background:rgba(34,211,238,.72);border-radius:50%;box-shadow:0 0 0 3px rgba(8,145,178,.45),0 2px 8px #0008;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:left 45ms linear,top 45ms linear,scale 120ms ease'; document.body.appendChild(cursor); document.addEventListener('mousemove', event => { cursor.style.left = event.clientX + 'px'; cursor.style.top = event.clientY + 'px'; }, true); document.addEventListener('click', () => { cursor.style.scale = '1.7'; setTimeout(() => { cursor.style.scale = '1'; }, 160); }, true); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install(); })();`,
    })
    await send('Page.navigate', { url: 'http://localhost:5173/' })
    await sleep(5000)

    encoder = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30',
      '-vcodec', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUTPUT,
    ], { stdio: ['pipe', 'ignore', 'inherit'] })
    await new Promise((resolve, reject) => {
      encoder.once('spawn', resolve)
      encoder.once('error', reject)
    })
    await send('Page.startScreencast', {
      format: 'jpeg', quality: 82, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
    })
    frameTimer = setInterval(() => {
      if (latestFrame) encoder.stdin.write(latestFrame)
    }, 1000 / 30)

    const steps = TEST ? TEST_STEPS : CLOSING ? CLOSING_STEPS : TAIL ? TAIL_STEPS : DEMO_STEPS
    for (const step of steps) {
      const started = Date.now()
      await navigateTo(step.url)
      await sleep(TEST ? 800 : 5000)
      if (step.actions) {
        for (const action of step.actions) {
          await runAction(action)
          await sleep(TEST ? 500 : 2500)
        }
      }
      if (step.scrolls) {
        for (const fraction of step.scrolls) {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1800, y: 900 })
          await send('Runtime.evaluate', {
            expression: `window.scrollTo({top: Math.max(0, document.documentElement.scrollHeight - innerHeight) * ${fraction}, behavior: 'smooth'})`,
          })
          await sleep(TEST ? 500 : 11000)
        }
      }
      const remaining = step.seconds * 1000 - (Date.now() - started)
      if (remaining > 0) await sleep(remaining)
    }

    await send('Page.stopScreencast')
  clearInterval(frameTimer)
    encoder.stdin.end()
    await new Promise((resolve, reject) => {
      encoder.once('close', (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`)))
    })
    console.log(`Recorded ${frames} browser frames to ${OUTPUT}`)
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close()
    if (encoder && !encoder.killed) encoder.kill()
    browser.kill()
    fs.rm(profile, { recursive: true, force: true }, () => {})
  }

  async function runAction(action) {
    const selectors = {
      time: `document.querySelector('[aria-label="Glucose time cursor"]')`,
      play: `document.querySelector('[aria-label="Play time cursor"]')`,
      alerts: `document.querySelector('[aria-label^="Open alerts"]')`,
      preset: `[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Millet khichdi'))`,
      custom: `[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Run Custom Scenario'))`,
      horizons: `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Horizons')`,
    }
    if (selectors[action]) await clickElement(selectors[action], action === 'time' ? 0.82 : 0.5)
  }

  async function navigateTo(route) {
    const expression = `(() => { const link = [...document.querySelectorAll('a[href]')].find(element => new URL(element.href).pathname === ${JSON.stringify(route)}); if (!link) return null; const rect = link.getBoundingClientRect(); return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}; })()`
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    const point = result.result?.value
    if (point && point.y >= 0 && point.y <= 1080) {
      await clickPoint(point.x, point.y)
    } else {
      await send('Page.navigate', { url: `http://localhost:5173${route}` })
    }
  }

  async function clickElement(elementExpression, horizontal = 0.5) {
    const expression = `(() => { const element = ${elementExpression}; if (!element) return null; const rect = element.getBoundingClientRect(); return {x: rect.left + rect.width * ${horizontal}, y: rect.top + rect.height / 2}; })()`
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    const point = result.result?.value
    if (point) await clickPoint(point.x, point.y)
  }

  async function clickPoint(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(180)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})