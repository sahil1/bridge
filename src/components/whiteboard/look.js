// How a whiteboard looks. Clean is Bridge AI's own, and the default: straight lines, a plain sans
// font, arrows that turn at right angles and snap to shapes, Bridge AI's colours. Hand-drawn is
// Excalidraw's sketchy style, there for those who want it (the whiteboard's settings).
//   Colours are kept as they show on a light board: in a dark theme Excalidraw turns the whole
//   drawing dark (its canvas filter), so one set of colours suits both. The board's own background
//   is see-through, so it's the pane's colour in either theme.
//   Excalidraw takes only its own fonts, so text is in the closest of them to Bridge AI's: Nunito,
//   a plain sans that every Excalidraw opens the same way.

export const FONTS = { clean: 6, sketch: 5 } // Nunito, Excalifont (Excalidraw's FONT_FAMILY)
const LOOK_FONTS = new Set([1, 2, 5, 6, 9]) // Virgil, Helvetica, Excalifont, Nunito, Liberation Sans
export const INK = '#1f2733'

export const LOOKS = {
  clean: { roughness: 0, font: FONTS.clean, fontSize: 16, strokeWidth: 1, arrowType: 'elbow', arrowhead: 'triangle' },
  sketch: { roughness: 1, font: FONTS.sketch, fontSize: 20, strokeWidth: 2, arrowType: 'round', arrowhead: 'arrow' },
}
export const lookOf = (name) => LOOKS[name] || LOOKS.clean

// What new shapes start as, drawn by hand on a board with this look.
export function toolDefaults(name) {
  const l = lookOf(name)
  return {
    currentItemRoughness: l.roughness, currentItemFontFamily: l.font, currentItemFontSize: l.fontSize, currentItemStrokeWidth: l.strokeWidth,
    currentItemArrowType: l.arrowType, currentItemEndArrowhead: l.arrowhead, currentItemStrokeColor: INK, currentItemRoundness: 'round',
    currentItemFillStyle: 'solid',
  }
}

// The look a board is in, from its shapes: hand-drawn when most of them are sketchy.
export function lookOfElements(elements) {
  const shapes = elements.filter((e) => !e.isDeleted && e.type !== 'text' && e.type !== 'image' && typeof e.roughness === 'number')
  if (!shapes.length) return null
  return shapes.filter((e) => e.roughness > 0).length > shapes.length / 2 ? 'sketch' : 'clean'
}

// Elements in a look: their lines, their words' font and size where it's the other look's, their
// arrows' kind. Code (Cascadia) and Comic Shanns stay as they are.
export function restyle(X, elements, name, { arrows = true } = {}) {
  const l = lookOf(name)
  const other = name === 'sketch' ? LOOKS.clean : LOOKS.sketch
  return elements.map((e) => {
    if (e.isDeleted) return e
    const up = {}
    if (typeof e.roughness === 'number' && e.roughness !== l.roughness && e.type !== 'image') up.roughness = l.roughness
    if (e.type === 'text' && LOOK_FONTS.has(e.fontFamily) && e.fontFamily !== l.font) up.fontFamily = l.font
    if (e.type !== 'text' && e.strokeWidth === other.strokeWidth) up.strokeWidth = l.strokeWidth
    if (arrows && e.type === 'arrow' && !e.elbowed && name === 'sketch' && !e.roundness) up.roundness = { type: 2 }
    return Object.keys(up).length ? X.newElementWith(e, up) : e
  })
}

// Colours for what a model draws: by the part a shape plays, in the set of colours the user
// prefers (soft by default; muted greys, vivid, or no fills at all).
const SCHEMES = {
  soft: { process: ['#ffffff', '#334155'], decision: ['#fff4d6', '#b7791f'], start: ['#e3f5ea', '#1f9d55'], note: ['#fff6bf', '#b59a00'], container: ['#f6f8fb', '#94a3b8'] },
  muted: { process: ['#f8fafc', '#475569'], decision: ['#f1f5f9', '#475569'], start: ['#f1f5f9', '#475569'], note: ['#f8fafc', '#64748b'], container: ['#f8fafc', '#cbd5e1'] },
  vivid: { process: ['#dbe7ff', '#2f6fe0'], decision: ['#ffe8a3', '#c98500'], start: ['#c7f0d6', '#1f9d55'], note: ['#fff08a', '#b59a00'], container: ['#eef4ff', '#6b8fd6'] },
  none: { process: ['transparent', INK], decision: ['transparent', INK], start: ['transparent', INK], note: ['transparent', INK], container: ['transparent', '#94a3b8'] },
}
export const colourFor = (role, scheme = 'soft') => (SCHEMES[scheme] || SCHEMES.soft)[role] || SCHEMES.soft.process

// Containers by kind: a region's border is dashed, a network's solid, a subnet's tinted.
export const CONTAINER_STYLE = {
  region: { fill: '#fbfcfe', stroke: '#64748b', dashed: true },
  vpc: { fill: '#f3faf5', stroke: '#2f855a', dashed: false },
  subnet: { fill: '#eef5ff', stroke: '#2f6fe0', dashed: false },
  zone: { fill: '#fafbfc', stroke: '#2f6fe0', dashed: true },
  cluster: { fill: '#f7f3ff', stroke: '#7c4dff', dashed: false },
  group: { fill: '#f8fafc', stroke: '#94a3b8', dashed: true },
  lane: { fill: '#fbfcfd', stroke: '#94a3b8', dashed: false },
  pool: { fill: 'transparent', stroke: '#64748b', dashed: false },
}

// Words are measured as they're made, so the look's font must have loaded first: measured in
// another, they'd be cut off once drawn in it. Excalidraw starts loading it when the board opens.
export async function fontsReady(name) {
  const family = lookOf(name).font === FONTS.sketch ? 'Excalifont' : 'Nunito'
  try { await Promise.race([document.fonts.load(`16px "${family}"`).then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 3000))]) } catch { /* drawn in the fallback, measured again below */ }
}
// Words made before their font had loaded (a diagram handed over, drawn as the board opened),
// measured again in it. ids: only these and the words in them.
export async function remeasure(X, ex, ids = null, name = 'clean') {
  await fontsReady(name)
  const all = ex.getSceneElementsIncludingDeleted()
  const pick = all.filter((e) => !e.isDeleted && (!ids || ids.has(e.id) || ids.has(e.containerId)))
  const fresh = new Map(X.restoreElements(pick, null, { refreshDimensions: true }).filter((e) => e.type === 'text').map((e) => [e.id, e]))
  if (fresh.size) ex.updateScene({ elements: all.map((e) => fresh.get(e.id) || e) })
}

// Where the board is: its background is the pane's own colour, unless one was picked. Older
// boards were made white; white is taken as not picked.
export const clearBackground = (appState = {}) => ({ ...appState, viewBackgroundColor: !appState.viewBackgroundColor || /^#fff(fff)?$/i.test(appState.viewBackgroundColor) ? 'transparent' : appState.viewBackgroundColor })
// For a picture of the board: white, or what was picked (Excalidraw darkens it for a dark picture).
export const solidBackground = (appState = {}) => ({ ...appState, viewBackgroundColor: !appState.viewBackgroundColor || appState.viewBackgroundColor === 'transparent' ? '#ffffff' : appState.viewBackgroundColor })
