// Shapes that hold others: a container (a region, a network, a subnet, a lane) and an icon's node.
// Dragging one takes along whatever lies inside it, as in Lucidchart, and a click on an icon's
// picture picks its node. What's inside is worked out from where things are, not kept in a list,
// so a shape dropped into a container belongs to it and one dragged out doesn't, and copies work
// the same way.
//   It's done by widening the selection when the pointer goes down on a holder, so Excalidraw moves
//   everything together itself (arrows joined to them follow), and narrowing it back to the holder
//   once the pointer is up.

export const holderOf = (e) => (e && !e.isDeleted ? e.customData?.bridge?.holder || null : null)
export const isContainer = (e) => !!holderOf(e) && holderOf(e) !== 'node'
// Where an element is; a line's or an arrow's from its points, which can go either way from it.
export function box(e) {
  if (Array.isArray(e.points) && e.points.length) {
    const xs = e.points.map((p) => e.x + p[0]), ys = e.points.map((p) => e.y + p[1])
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }
  }
  return { x1: Math.min(e.x, e.x + e.width), y1: Math.min(e.y, e.y + e.height), x2: Math.max(e.x, e.x + e.width), y2: Math.max(e.y, e.y + e.height) }
}
export const within = (a, b, slack = 1) => { const p = box(a), q = box(b); return p.x1 >= q.x1 - slack && p.y1 >= q.y1 - slack && p.x2 <= q.x2 + slack && p.y2 <= q.y2 + slack }

// Everything inside a holder: shapes, pictures, words and arrows lying wholly within it. Words in
// a shape aren't counted: Excalidraw moves them with their shape.
export function contents(holder, elements) {
  return elements.filter((e) => !e.isDeleted && e.id !== holder.id && !e.containerId && within(e, holder))
}
// The node an icon's picture (or anything small) sits in: the smallest one around it.
export function nodeAround(e, elements) {
  if (!e || holderOf(e)) return null
  let best = null
  for (const n of elements) if (holderOf(n) === 'node' && n.id !== e.id && within(e, n) && (!best || n.width * n.height < best.width * best.height)) best = n
  return best
}

// Wired to a board (Excalidraw's api). Returns a function that unhooks it.
export function holdTogether(ex) {
  let held = null
  const offDown = ex.onPointerDown((tool, state, event) => {
    held = null
    if (tool?.type !== 'selection' || event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey) return
    let hit = state?.hit?.element
    if (!hit || hit.groupIds?.length) return
    const els = ex.getSceneElements()
    // Excalidraw picks what's selected first: with a container selected, a click on a shape inside
    // it would take the container. The shape on top where the pointer is goes instead.
    const at = state.origin
    if (isContainer(hit) && at) {
      const top = [...els].reverse().find((e) => e.id !== hit.id && !e.containerId && e.type !== 'arrow' && e.type !== 'line' && !e.isDeleted && within({ x: at.x, y: at.y, width: 0, height: 0 }, e, 0) && within(e, hit))
      if (top && !top.groupIds?.length) hit = top
    }
    const target = holderOf(hit) ? hit : nodeAround(hit, els)
    if (!target) return
    const inside = contents(target, els)
    if (!inside.length && target === hit) return
    held = target.id
    ex.updateScene({ appState: { selectedElementIds: Object.fromEntries([target, ...inside].map((e) => [e.id, true])), selectedGroupIds: {} } })
  })
  // After Excalidraw has settled the click (it picks again on the pointer going up).
  const offUp = ex.onPointerUp(() => {
    const id = held
    held = null
    if (!id) return
    setTimeout(() => { if (ex.getSceneElements().some((e) => e.id === id)) ex.updateScene({ appState: { selectedElementIds: { [id]: true }, selectedGroupIds: {} } }) }, 0)
  })
  return () => { offDown?.(); offUp?.() }
}
