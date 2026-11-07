// Where a signature, initials or a date go inside the box you placed on a PDF page, worked out the
// same way for what the page shows before you approve (src/components/studio/pdf) and for what
// server/signing.js writes, so the signed copy looks like the preview. Boxes are in the PDF's own
// points ({ x, y, w, h }, from the page's bottom left); u and v are across and up the box as the
// page is shown, which differs from the PDF's own axes on a page turned 90, 180 or 270 degrees.

// The box as shown: a page turned a quarter shows its width as height.
export const shownSize = (box, rotation = 0) => (rotation % 180 ? { w: box.h, h: box.w } : { w: box.w, h: box.h })

// A picture (iw by ih) as large as it fits in a box shown w by h, keeping its shape: centred in a
// form's own field, and on the line, to the left, where it was found from the text around it.
export function fitImage(w, h, iw, ih, align = 'center') {
  const s = Math.min(w / Math.max(1, iw), h / Math.max(1, ih))
  const dw = iw * s, dh = ih * s
  return { u: align === 'left' ? 0 : (w - dw) / 2, v: align === 'left' ? 0 : (h - dh) / 2, w: dw, h: dh }
}

// A date's size in points: 12 at most, seven tenths of the box's height, and small enough to fit
// across it (width1: how wide the text is at size 1, in Helvetica or Arial, which measure alike).
export const DATE_PAD = 2
export const dateSize = (w, h, width1) => Math.max(4, Math.min(12, h * 0.7, (w - DATE_PAD * 2) / Math.max(0.01, width1)))
// Where its first letter sits on the line: the left, and the middle of the box (a capital is about
// seven tenths of the size).
export const dateSpot = (h, size) => ({ u: DATE_PAD, v: (h - size * 0.7) / 2 })

// A point (u, v) in the box as shown, in the PDF's own points.
export function toUser(box, rotation, u, v) {
  const { x, y, w, h } = box
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: x + w - v, y: y + u }
    case 180: return { x: x + w - u, y: y + h - v }
    case 270: return { x: x + v, y: y + h - u }
    default: return { x: x + u, y: y + v }
  }
}

// A new box's size by kind, in points, when it's added by hand or found from text alone.
export const SIZES = { signature: { w: 180, h: 46 }, initials: { w: 64, h: 34 }, date: { w: 120, h: 18 } }
export const KINDS = Object.keys(SIZES)
