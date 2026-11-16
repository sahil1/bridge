// Pictures of call windows while someone shares their screen, drawn in a page and taken as JPEGs
// the way a watched screen's are: Teams (people down the right, buttons along the bottom), Zoom
// (people across the top), Meet (people beside it), and a screen shared on its own with no call
// round it. Each says where the slide is in it, to check a crop against. (meeting-crop)

// A slide: a title, points, a chart and a picture, on white (or dark: a deck with a dark theme).
// n changes what's on it, as the next slide would.
function slide(n = 1, { dark = false, bg } = {}) {
  const fg = dark ? '#e8eaf0' : '#1d2433', back = bg || (dark ? '#0d1b2a' : '#ffffff')
  const bars = [62, 80, 45, 92, 70].map((v, i) => `<div style="height:${(v + n * 7 * (i + 1)) % 95 + 5}%;background:${['#2f6fec', '#e8543f', '#f5b800', '#18a05e', '#8a4fd8'][i]};flex:1;margin:0 4%"></div>`).join('')
  return `<div class="slide" style="background:${back};color:${fg};font-family:Helvetica,Arial,sans-serif;position:absolute;inset:0;padding:5% 6%;box-sizing:border-box;overflow:hidden">
    <div style="font-size:5.2cqw;font-weight:700;margin-bottom:3%">${['Quarterly plan', 'Hiring for the new team', 'What customers told us', 'Budget for next year', 'Roadmap: the next two quarters'][n % 5]}</div>
    <div style="display:flex;gap:5%;height:70%">
      <ul style="font-size:2.4cqw;line-height:1.6;flex:1.1;margin:0;padding-left:4%">${['Revenue up 18% on last year', 'Two new regions open in May', 'Support tickets down by a third', 'Churn under 2% for the first time', `Next review on the ${n + 3}th`].map((x) => `<li>${x}</li>`).join('')}</ul>
      <div style="flex:1;display:flex;flex-direction:column;gap:4%">
        <div style="flex:1.4;display:flex;align-items:flex-end;border-left:2px solid ${fg};border-bottom:2px solid ${fg};padding:2%">${bars}</div>
        <div style="flex:1;background:linear-gradient(135deg,#7fb3d5,#2e4053 60%,#d4ac0d);border-radius:2px"></div>
      </div>
    </div>
  </div>`
}

// Someone on camera: a room behind them (a gradient with some grain), a head and shoulders. seed
// picks the room and where they sit; off: their camera's off (their initials in a circle).
const tones = ['#c68863', '#8d5524', '#e0ac69', '#f1c27d', '#a0663f']
const rooms = [['#6b7a8f', '#b8c4cf'], ['#4b3f35', '#a68a64'], ['#2f4f4f', '#8fbc8f'], ['#5d4157', '#c9a0b4'], ['#3b4a6b', '#9fb1d4']]
function person(name, seed, { off = false, talking = false, tile = '#2b2b2b', round = 6 } = {}) {
  const [a, b] = rooms[seed % rooms.length]
  const inner = off
    ? `<div style="position:absolute;inset:0;background:${tile}"></div><div style="position:absolute;left:50%;top:42%;width:28%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:${['#7a5af5', '#e06c2c', '#2ca58d', '#d63d6a'][seed % 4]};color:#fff;display:flex;align-items:center;justify-content:center;font:600 1.6cqw Helvetica,Arial,sans-serif">${name.split(' ').map((x) => x[0]).join('')}</div>`
    : `<div style="position:absolute;inset:0;background:radial-gradient(circle at ${30 + seed * 9}% 30%,${b},${a})"></div><canvas class="grain" data-seed="${seed}" style="position:absolute;inset:0;width:100%;height:100%;opacity:.35"></canvas>
       <div style="position:absolute;left:${38 + (seed % 3) * 6}%;top:18%;width:24%;height:46%;border-radius:50%;background:${tones[seed % tones.length]}"></div>
       <div style="position:absolute;left:${26 + (seed % 3) * 6}%;top:60%;width:48%;height:45%;border-radius:40% 40% 0 0;background:${['#2c3e50', '#7d3c98', '#1e8449', '#b03a2e'][seed % 4]}"></div>`
  return `<div class="tile" style="position:relative;overflow:hidden;border-radius:${round}px;${talking ? 'box-shadow:inset 0 0 0 2px #7f85f5;' : ''}width:100%;height:100%;container-type:inline-size">${inner}
    <div style="position:absolute;left:6px;bottom:6px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;font:12px Helvetica,Arial,sans-serif">${name}</div></div>`
}
const PEOPLE = ['Priya Shah', 'Dan Ruiz', 'Mei Chen', 'Sam Lee', 'Ana Costa', 'Tom Berg']
const GRAIN = `<script>for (const c of document.querySelectorAll('canvas.grain')) { const r = c.getBoundingClientRect(); c.width = Math.max(1, r.width | 0); c.height = Math.max(1, r.height | 0); const x = c.getContext('2d'), d = x.createImageData(c.width, c.height); let s = +c.dataset.seed * 7919 + 13; for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) % 2147483648; const v = s / 2147483648 * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255 } x.putImageData(d, 0, 0) }</script>`
const page = (W, H, body, bg) => `<!doctype html><html><head><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${bg}} .box{position:absolute;container-type:inline-size} .icon{display:inline-block;width:20px;height:20px;border-radius:4px;border:2px solid #d0d0d0;box-sizing:border-box}</style></head><body>${body}${GRAIN}</body></html>`
const fit = (bw, bh, aspect) => (bw / bh > aspect ? { w: Math.round(bh * aspect), h: bh } : { w: bw, h: Math.round(bw / aspect) })
const box = (x, y, w, h, inner, extra = '') => `<div class="box" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${extra}">${inner}</div>`

// Each: (W, H, n, o) => { html, slide: { x0, y0, x1, y1 } }. o: { people (how many), off (cameras
// off), dark (a dark slide), aspect }.
export const LAYOUTS = {
  // Teams: the title and time in a bar at the top, the slide on a dark stage, people down the right,
  // the buttons along the bottom.
  teams(W, H, n = 1, o = {}) {
    const top = 48, bottom = 64, strip = Math.round(W * 0.16), gap = 8
    const stage = { x: gap, y: top + gap, w: W - strip - 3 * gap, h: H - top - bottom - 2 * gap }
    const s = fit(stage.w, stage.h, o.aspect || 16 / 9)
    const sx = stage.x + Math.round((stage.w - s.w) / 2), sy = stage.y + Math.round((stage.h - s.h) / 2)
    const k = o.people ?? 4
    const th = Math.round(strip * 9 / 16)
    const tiles = PEOPLE.slice(0, k).map((p, i) => box(W - strip - gap, top + gap + i * (th + gap), strip, th, person(p, i + n, { off: o.off, talking: i === n % k, tile: '#333333' })))
    const bar = (y, h, inner) => box(0, y, W, h, inner, 'background:#292929;display:flex;align-items:center;gap:18px;padding:0 18px;box-sizing:border-box;color:#e6e6e6;font:14px Helvetica,Arial,sans-serif')
    return {
      slide: { x0: sx, y0: sy, x1: sx + s.w, y1: sy + s.h },
      html: page(W, H, bar(0, top, `<b>Q3 planning</b><span style="opacity:.7">32:14</span><span style="flex:1"></span><span class="icon"></span><span class="icon"></span><span class="icon"></span>`)
        + box(sx, sy, s.w, s.h, slide(n, o))
        + tiles.join('')
        + bar(H - bottom, bottom, `<span style="flex:1"></span>${'<span class="icon" style="width:28px;height:28px"></span>'.repeat(6)}<span style="background:#c4314b;color:#fff;padding:7px 16px;border-radius:4px">Leave</span><span style="flex:1"></span>`), '#1b1b1b'),
    }
  },
  // Zoom: "You're viewing Sam Lee's screen" at the top, the people in a strip under it, the slide on
  // black, the buttons along the bottom.
  zoom(W, H, n = 1, o = {}) {
    const top = 36, bottom = 60, gap = 4
    const k = o.people ?? 5
    const tw = Math.round(W * 0.1), th = Math.round(tw * 9 / 16)
    const sy0 = top + th + 2 * gap + 6
    const stage = { x: 0, y: sy0, w: W, h: H - sy0 - bottom - gap }
    const s = fit(stage.w, stage.h, o.aspect || 16 / 9)
    const sx = Math.round((W - s.w) / 2), sy = stage.y + Math.round((stage.h - s.h) / 2)
    const x0 = Math.round((W - (k * tw + (k - 1) * gap)) / 2)
    const tiles = PEOPLE.slice(0, k).map((p, i) => box(x0 + i * (tw + gap), top + gap, tw, th, person(p, i + 2 * n, { off: o.off || i === 3, tile: '#232323', round: 0 })))
    return {
      slide: { x0: sx, y0: sy, x1: sx + s.w, y1: sy + s.h },
      html: page(W, H, box(0, 0, W, top, `<span style="background:#23d959;color:#000;padding:4px 10px;border-radius:4px">You're viewing Sam Lee's screen</span><span style="flex:1"></span><span>View Options</span>`, 'background:#1a1a1a;display:flex;align-items:center;gap:12px;padding:0 12px;box-sizing:border-box;color:#fff;font:13px Helvetica,Arial,sans-serif')
        + tiles.join('')
        + box(sx, sy, s.w, s.h, slide(n, o))
        + box(0, H - bottom, W, bottom, `${['Mute', 'Stop Video', 'Security', 'Participants', 'Chat', 'Share Screen', 'Record', 'Reactions'].map((x) => `<span style="display:flex;flex-direction:column;align-items:center;gap:4px"><span class="icon"></span>${x}</span>`).join('')}<span style="flex:1"></span><span style="background:#e02828;padding:6px 14px;border-radius:6px">End</span>`, 'background:#1a1a1a;display:flex;align-items:center;gap:26px;padding:0 24px;box-sizing:border-box;color:#fff;font:11px Helvetica,Arial,sans-serif'), '#000000'),
    }
  },
  // Meet: the slide with its corners rounded and who's presenting on it, people beside it on the
  // right, the time and the buttons along the bottom, all on Meet's grey.
  meet(W, H, n = 1, o = {}) {
    const bottom = 80, pad = 16, gap = 8
    const k = o.people ?? 3
    const col = Math.round(W * 0.2)
    const stage = { x: pad, y: pad, w: W - col - 2 * pad - gap, h: H - bottom - pad }
    const s = fit(stage.w, stage.h, o.aspect || 16 / 9)
    const sx = stage.x + Math.round((stage.w - s.w) / 2), sy = stage.y + Math.round((stage.h - s.h) / 2)
    const th = Math.round(col * 9 / 16)
    const ty = pad + Math.round((stage.h - (k * th + (k - 1) * gap)) / 2)
    const tiles = PEOPLE.slice(0, k).map((p, i) => box(W - col - pad, ty + i * (th + gap), col, th, person(p, i + 3 * n, { off: o.off, tile: '#3c4043', round: 10 })))
    return {
      slide: { x0: sx, y0: sy, x1: sx + s.w, y1: sy + s.h },
      html: page(W, H, box(sx, sy, s.w, s.h, `${slide(n, o)}<div style="position:absolute;left:12px;bottom:10px;background:rgba(32,33,36,.8);color:#fff;padding:3px 8px;border-radius:4px;font:13px Helvetica,Arial,sans-serif">Sam Lee (Presenting)</div>`, 'border-radius:10px;overflow:hidden')
        + tiles.join('')
        + box(0, H - bottom, W, bottom, `<span style="width:28%">10:42 | abc-defg-hij</span><span style="flex:1;display:flex;justify-content:center;gap:12px">${'<span style="width:40px;height:40px;border-radius:50%;background:#3c4043"></span>'.repeat(5)}<span style="width:56px;height:40px;border-radius:20px;background:#ea4335"></span></span><span style="width:28%;text-align:right"><span class="icon"></span> <span class="icon"></span></span>`, 'display:flex;align-items:center;padding:0 24px;box-sizing:border-box;color:#e8eaed;font:15px Helvetica,Arial,sans-serif'), '#202124'),
    }
  },
  // A call with nobody sharing: Teams' gallery, everyone on a tile of one size. (slide: none.)
  gallery(W, H, n = 1, o = {}) {
    const top = 48, bottom = 64, gap = 8, k = o.people ?? 6
    const cols = k <= 4 ? 2 : 3, rows = Math.ceil(k / cols)
    const s = fit(Math.floor((W - (cols + 1) * gap) / cols), Math.floor((H - top - bottom - (rows + 1) * gap) / rows), 16 / 9)
    const x0 = Math.round((W - cols * s.w - (cols - 1) * gap) / 2), y0 = top + Math.round((H - top - bottom - rows * s.h - (rows - 1) * gap) / 2)
    const tiles = PEOPLE.slice(0, k).map((p, i) => box(x0 + (i % cols) * (s.w + gap), y0 + Math.floor(i / cols) * (s.h + gap), s.w, s.h, person(p, i + n, { off: o.off, tile: '#333333' })))
    const bar = (y, h, inner) => box(0, y, W, h, inner, 'background:#292929;display:flex;align-items:center;gap:18px;padding:0 18px;box-sizing:border-box;color:#e6e6e6;font:14px Helvetica,Arial,sans-serif')
    return { slide: null, html: page(W, H, bar(0, top, '<b>Q3 planning</b><span style="opacity:.7">32:14</span>') + tiles.join('') + bar(H - bottom, bottom, `<span style="flex:1"></span>${'<span class="icon" style="width:28px;height:28px"></span>'.repeat(6)}<span style="flex:1"></span>`), '#1b1b1b') }
  },
  // No call: a deck being edited, its slides' thumbnails in a column beside the one open, a ribbon
  // above and notes below (light, or dark: o.dark). (slide: none.)
  editor(W, H, n = 1, o = {}) {
    const [bg, panel, ink] = o.dark ? ['#1f1f1f', '#2b2b2b', '#e6e6e6'] : ['#e9e9e9', '#f6f6f6', '#222']
    const ribbon = 96, notes = 70, side = Math.round(W * 0.14), gap = 14
    const tw = side - 40, th = Math.round(tw * 9 / 16)
    const thumbs = [1, 2, 3, 4, 5].map((k, i) => box(30, ribbon + gap + i * (th + gap), tw, th, slide(n + k, {}), 'border:1px solid #888;overflow:hidden;container-type:inline-size') + box(8, ribbon + gap + i * (th + gap), 16, 16, `<span style="color:${ink};font:11px Helvetica,Arial,sans-serif">${k}</span>`)).join('')
    const stage = { x: side + gap, y: ribbon + gap, w: W - side - 2 * gap, h: H - ribbon - notes - 2 * gap }
    const s = fit(stage.w, stage.h, 16 / 9)
    const sx = stage.x + Math.round((stage.w - s.w) / 2), sy = stage.y + Math.round((stage.h - s.h) / 2)
    return { slide: null, html: page(W, H, box(0, 0, W, ribbon, `${['File', 'Home', 'Insert', 'Design', 'Transitions', 'Animations', 'Slide Show', 'Review', 'View'].map((x) => `<span>${x}</span>`).join('')}`, `background:${panel};display:flex;gap:22px;padding:14px 20px;box-sizing:border-box;color:${ink};font:13px Helvetica,Arial,sans-serif`)
      + thumbs + box(sx, sy, s.w, s.h, slide(n, {}))
      + box(0, H - notes, W, notes, `<span>Speaker notes: open with the revenue numbers, then the hiring plan.</span>`, `background:${panel};padding:14px 20px;box-sizing:border-box;color:${ink};font:14px Helvetica,Arial,sans-serif`), bg) }
  },
  // A screen shared on its own: the slide fills it, nothing round it.
  plain(W, H, n = 1, o = {}) {
    return { slide: { x0: 0, y0: 0, x1: W, y1: H }, html: page(W, H, box(0, 0, W, H, slide(n, o)), '#ffffff') }
  },
  // A slide with no call round it but a row of logos at its foot, which a careless crop would take
  // for people.
  logos(W, H, n = 1, o = {}) {
    const row = ['#d35400', '#2471a3', '#229954', '#7d3c98'].map((c, i) => `<div style="position:absolute;bottom:4%;left:${10 + i * 21}%;width:16%;aspect-ratio:16/9;background:${c};border-radius:4px;color:#fff;display:flex;align-items:center;justify-content:center;font:700 2cqw Helvetica,Arial,sans-serif">Partner ${i + 1}</div>`).join('')
    return { slide: { x0: 0, y0: 0, x1: W, y1: H }, html: page(W, H, box(0, 0, W, H, `${slide(n, { ...o, dark: o.dark ?? true })}${row}`), '#ffffff') }
  },
}

// A picture of one: { jpeg, slide, W, H }. p: a Playwright page (its viewport is set to W by H).
export async function render(p, name, { W = 1920, H = 1080, n = 1, ...o } = {}) {
  await p.setViewportSize({ width: W, height: H })
  const { html, slide: s } = LAYOUTS[name](W, H, n, o)
  await p.setContent(html)
  const jpeg = await p.screenshot({ type: 'jpeg', quality: 86 })
  return { jpeg, slide: s, W, H }
}
