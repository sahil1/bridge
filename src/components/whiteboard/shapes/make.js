// A shape from the catalog (shared/whiteboard/catalog.js) as whiteboard elements: what the Shapes
// panel adds, and what a model's diagram is drawn with (spec.js).
//   A box, diamond or circle is one Excalidraw shape with its words inside.
//   An icon is a node: an invisible box that holds the picture and has the name under it, so a
//   double-click edits the name and arrows join the node, not the picture (holders.js moves the
//   picture with it).
//   A container is a box with its name at the top left, that holds what's inside it.
// X is the Excalidraw module, handed in so nothing here loads it.
import { GLYPHS } from './icons.js'
import { INK, lookOf, colourFor, CONTAINER_STYLE } from '../look.js'

export const NODE = { w: 120, h: 112, icon: 56 }
export const SIZE = { rectangle: [160, 64], diamond: [170, 100], ellipse: [120, 72], pill: [160, 60], note: [170, 110], text: [120, 24] }
const ROLE = { rectangle: 'process', diamond: 'decision', ellipse: 'start', pill: 'start', note: 'note' }

const mix = (hex, toward, t) => {
  const a = parseInt(hex.slice(1), 16), b = parseInt(toward.slice(1), 16)
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
}
// An icon's picture: its glyph in its colour on a tile of the same colour, faint. An SVG, so a dark
// theme turns it dark with the rest of the drawing.
export function iconSvg(glyph, color = '#2f6fe0') {
  const inner = GLYPHS[glyph] || GLYPHS.box || ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="14" fill="${mix(color, '#ffffff', 0.9)}" stroke="${color}" stroke-width="2"/><g transform="translate(14 14) scale(1.5)" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`
}
// The same picture as one of the board's files, named for what it is so a board keeps one copy.
export function iconFile(glyph, color) {
  const id = `bridge-icon-${glyph}-${String(color || '').replace(/[^0-9a-f]/gi, '')}`
  return { id, mimeType: 'image/svg+xml', dataURL: `data:image/svg+xml;base64,${btoa(iconSvg(glyph, color))}`, created: 1 }
}

// The skeleton (Excalidraw's convertToExcalidrawElements input) for one item at x, y (its top
// left). ref: an id the caller can find it by (customData.bridge.ref) and join arrows to.
export function skeletonOf(item, { x = 0, y = 0, label, look = 'clean', scheme = 'soft', ref, w, h } = {}) {
  const l = lookOf(look)
  const text = label ?? item.name
  const base = { roughness: l.roughness, strokeWidth: l.strokeWidth }
  const words = (o = {}) => (text ? { label: { text, fontSize: o.size || l.fontSize - (look === 'clean' ? 2 : 0), fontFamily: l.font, strokeColor: o.ink || INK, ...o.align } } : {})
  const data = (more) => ({ customData: { bridge: { item: item.id, ...(ref ? { ref } : {}), ...more } } })
  if (item.kind === 'icon') {
    const f = iconFile(item.glyph, item.color)
    const W = w || NODE.w, H = h || NODE.h
    return {
      files: { [f.id]: f },
      skeleton: [
        { type: 'image', x: x + (W - NODE.icon) / 2, y: y + 6, width: NODE.icon, height: NODE.icon, fileId: f.id, status: 'saved', ...data({ icon: true }) },
        { type: 'rectangle', id: ref, x, y, width: W, height: H, ...base, strokeColor: 'transparent', backgroundColor: 'transparent', roundness: { type: 3 }, ...words({ size: 14, align: { verticalAlign: 'bottom' } }), ...data({ holder: 'node' }) },
      ],
    }
  }
  if (item.kind === 'container') {
    const st = CONTAINER_STYLE[item.style] || CONTAINER_STYLE.group
    const fill = scheme === 'none' ? 'transparent' : st.fill
    return { files: {}, skeleton: [{ type: 'rectangle', id: ref, x, y, width: w || 420, height: h || 260, ...base, strokeColor: st.stroke, backgroundColor: fill, fillStyle: 'solid', strokeStyle: st.dashed ? 'dashed' : 'solid', roundness: { type: 3 }, ...words({ size: 14, ink: mix(st.stroke, '#000000', 0.25), align: { textAlign: 'left', verticalAlign: 'top' } }), ...data({ holder: item.style || 'group' }) }] }
  }
  if (item.kind === 'lanes') {
    const n = item.n || 3, W = w || 860, LH = 170, HEAD = 36
    const st = CONTAINER_STYLE.lane
    const skeleton = [{ type: 'rectangle', id: ref, x, y, width: W, height: HEAD + n * LH, ...base, strokeColor: CONTAINER_STYLE.pool.stroke, backgroundColor: 'transparent', ...words({ size: 15, align: { textAlign: 'left', verticalAlign: 'top' } }), ...data({ holder: 'pool' }) }]
    for (let i = 0; i < n; i++) skeleton.push({ type: 'rectangle', x: x + 0, y: y + HEAD + i * LH, width: W, height: LH, ...base, strokeColor: st.stroke, backgroundColor: scheme === 'none' ? 'transparent' : i % 2 ? '#f6f8fb' : st.fill, fillStyle: 'solid', label: { text: `${item.laneName || 'Lane'} ${i + 1}`, fontSize: 14, fontFamily: l.font, strokeColor: INK, textAlign: 'left', verticalAlign: 'top' }, customData: { bridge: { item: 'lane', holder: 'lane' } } })
    return { files: {}, skeleton }
  }
  if (item.kind === 'text') return { files: {}, skeleton: [{ type: 'text', x, y, text: text || item.name, fontSize: l.fontSize, fontFamily: l.font, strokeColor: INK, ...data({}) }] }
  const kind = item.shape || 'rectangle'
  const [fill, stroke] = colourFor(ROLE[kind] || 'process', scheme)
  const type = kind === 'pill' || kind === 'note' ? 'rectangle' : kind
  const [dw, dh] = SIZE[kind] || SIZE.rectangle
  return {
    files: {},
    skeleton: [{
      type, id: ref, x, y, width: w || dw, height: h || dh, ...base, strokeColor: stroke, backgroundColor: fill, fillStyle: 'solid',
      roundness: type === 'rectangle' ? { type: 3 } : type === 'diamond' ? { type: 2 } : null,
      ...words(kind === 'note' ? { align: { textAlign: 'left', verticalAlign: 'top' } } : {}), ...data({}),
    }],
  }
}

// One item as elements, centred on x, y: { elements, files }.
export function makeItem(X, item, { x = 0, y = 0, ...o } = {}) {
  const { skeleton, files } = skeletonOf(item, o)
  const els = X.convertToExcalidrawElements(skeleton)
  const b = X.getCommonBounds(els)
  const dx = x - (b[0] + b[2]) / 2, dy = y - (b[1] + b[3]) / 2
  return { elements: els.map((e) => X.newElementWith(e, { x: e.x + dx, y: e.y + dy })), files }
}
