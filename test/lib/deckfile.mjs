// A PowerPoint file as PowerPoint writes one, for Studio's tests: a slide master with its own
// shapes and text styles, layouts whose placeholders the slides inherit their places from, a theme
// with its colours and fonts (the slides name them, +mj-lt, accent1 a shade darker), a title slide,
// points in levels and numbers, two columns, shapes (rotated, flipped, an arrow, a line with an
// arrowhead), a group, a picture cropped, a table in a table style, a chart, a diagram, words in
// their own fonts, sizes, colours and alignment, speaker notes, a hidden slide, and as many slides
// as asked for. Made here from the XML itself (no library), so it's as close to PowerPoint's own as
// a test can have.
import JSZip from 'jszip'
import { chartPng } from './wordfile.mjs'

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.presentationml'
const EMU = 914400 // an inch
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const in2 = (x) => Math.round(x * EMU)

// ---------- Words ----------
// A run: { b, i, u, sz (pt), color (hex or a scheme colour), font }.
export const r = (text, o = {}) => {
  const fill = o.color ? (/^[0-9A-F]{6}$/i.test(o.color) ? `<a:solidFill><a:srgbClr val="${o.color}"/></a:solidFill>` : `<a:solidFill><a:schemeClr val="${o.color}"/></a:solidFill>`) : ''
  const attrs = `lang="en-US"${o.sz ? ` sz="${o.sz * 100}"` : ''}${o.b ? ' b="1"' : ''}${o.i ? ' i="1"' : ''}${o.u ? ' u="sng"' : ''} dirty="0"`
  return `<a:r><a:rPr ${attrs}>${fill}${o.font ? `<a:latin typeface="${esc(o.font)}"/>` : ''}</a:rPr><a:t>${esc(text)}</a:t></a:r>`
}
// A paragraph: runs (or a string), { lvl, algn, num, noBullet, lnSpc (%) }.
export const p = (runs, o = {}) => {
  const body = typeof runs === 'string' ? r(runs) : runs.join('')
  const ppr = [o.lvl ? ` lvl="${o.lvl}"` : '', o.algn ? ` algn="${o.algn}"` : '', o.num || o.noBullet ? ' marL="457200" indent="-457200"' : ''].join('')
  const inner = `${o.lnSpc ? `<a:lnSpc><a:spcPct val="${o.lnSpc * 1000}"/></a:lnSpc>` : ''}${o.num ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : ''}${o.noBullet ? '<a:buNone/>' : ''}`
  return `<a:p>${ppr || inner ? `<a:pPr${ppr}${inner ? `>${inner}</a:pPr>` : '/>'}` : ''}${body}<a:endParaRPr lang="en-US" dirty="0"/></a:p>`
}

// ---------- Shapes ----------
let nextId = 2
const nv = (name, more = '') => `<p:cNvPr id="${nextId++}" name="${esc(name)}"${more}/>`
// A placeholder, as a slide has one: its place and look from its layout.
export const ph = (type, idx, paras, name = 'Placeholder') => `<p:sp><p:nvSpPr>${nv(name)}<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${type ? ` type="${type}"` : ''}${idx != null ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras.join('')}</p:txBody></p:sp>`
const xfrm = (x, y, w, h, o = {}) => `<a:xfrm${o.rot ? ` rot="${o.rot * 60000}"` : ''}${o.flipH ? ' flipH="1"' : ''}><a:off x="${in2(x)}" y="${in2(y)}"/><a:ext cx="${in2(w)}" cy="${in2(h)}"/></a:xfrm>`
const fillOf = (f) => (!f ? '' : f === 'none' ? '<a:noFill/>' : /^[0-9A-F]{6}$/i.test(f) ? `<a:solidFill><a:srgbClr val="${f}"/></a:solidFill>` : `<a:solidFill><a:schemeClr val="${f}">${f === 'accent1' ? '<a:lumMod val="75000"/>' : ''}</a:schemeClr></a:solidFill>`)
// A shape (a text box when geom is rect and there's no fill), at inches: { geom, fill, line, rot, flipH, paras, anchor }.
export const shape = (name, x, y, w, h, o = {}) => {
  const ln = o.line ? `<a:ln w="${(o.lineW || 2) * 12700}">${fillOf(o.line)}${o.dash ? `<a:prstDash val="${o.dash}"/>` : ''}</a:ln>` : ''
  const style = o.styled ? '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>' : ''
  const paras = o.paras || [p('', {})]
  return `<p:sp><p:nvSpPr>${nv(name)}<p:cNvSpPr${o.box ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, w, h, o)}<a:prstGeom prst="${o.geom || 'rect'}"><a:avLst/></a:prstGeom>${fillOf(o.fill)}${ln}</p:spPr>${style}<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${o.anchor || 't'}">${o.autofit ? `<a:normAutofit fontScale="${o.autofit * 1000}" lnSpcReduction="10000"/>` : o.box ? '<a:spAutoFit/>' : ''}</a:bodyPr><a:lstStyle/>${paras.join('')}</p:txBody></p:sp>`
}
// A line from one point to another, with an arrowhead at its end.
export const line = (name, x1, y1, x2, y2, color = 'tx1') => `<p:cxnSp><p:nvCxnSpPr>${nv(name)}<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${y2 < y1 ? ' flipV="1"' : ''}><a:off x="${in2(Math.min(x1, x2))}" y="${in2(Math.min(y1, y2))}"/><a:ext cx="${in2(Math.abs(x2 - x1))}" cy="${in2(Math.abs(y2 - y1))}"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="28575">${fillOf(color)}<a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`
// Shapes in a group, its children placed in a space of their own scaled into the group's box.
export const group = (name, x, y, w, h, kids, ch = { x: 0, y: 0, w, h }) => `<p:grpSp><p:nvGrpSpPr>${nv(name)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${in2(x)}" y="${in2(y)}"/><a:ext cx="${in2(w)}" cy="${in2(h)}"/><a:chOff x="${in2(ch.x)}" y="${in2(ch.y)}"/><a:chExt cx="${in2(ch.w)}" cy="${in2(ch.h)}"/></a:xfrm></p:grpSpPr>${kids.join('')}</p:grpSp>`
// A picture, cropped by { l, t, r, b } (%).
export const pic = (name, rid, x, y, w, h, crop = null) => `<p:pic><p:nvPicPr>${nv(name, ` descr="${esc(name)}"`)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/>${crop ? `<a:srcRect l="${crop.l * 1000}" t="${crop.t * 1000}" r="${crop.r * 1000}" b="${crop.b * 1000}"/>` : ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
// A table in PowerPoint's Medium Style 2, Accent 1: a header row and banded rows.
export const table = (name, x, y, w, rows) => {
  const cols = rows[0].length, cw = in2(w / cols), rh = in2(0.5)
  const cell = (t, head) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${t ? r(t, head ? { b: true } : {}) : ''}<a:endParaRPr lang="en-US" dirty="0"/></a:p></a:txBody><a:tcPr/></a:tc>`
  return `<p:graphicFrame><p:nvGraphicFramePr>${nv(name)}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${in2(x)}" y="${in2(y)}"/><a:ext cx="${cw * cols}" cy="${rh * rows.length}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}</a:tableStyleId></a:tblPr><a:tblGrid>${rows[0].map(() => `<a:gridCol w="${cw}"/>`).join('')}</a:tblGrid>${rows.map((row, i) => `<a:tr h="${rh}">${row.map((c) => cell(c, i === 0)).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}
// A chart (its part is chartXml) or a diagram, in a frame.
export const frame = (name, kind, rid, x, y, w, h) => `<p:graphicFrame><p:nvGraphicFramePr>${nv(name)}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${in2(x)}" y="${in2(y)}"/><a:ext cx="${in2(w)}" cy="${in2(h)}"/></p:xfrm><a:graphic>${kind === 'chart' ? `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData>` : `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${rid}" r:lo="${rid}" r:qs="${rid}" r:cs="${rid}"/></a:graphicData>`}</a:graphic></p:graphicFrame>`
// A bar chart's own part, with the values PowerPoint keeps beside its workbook.
export function chartXml(title, cats, series) {
  const str = (vals) => `<c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`
  const num = (vals) => `<c:numRef><c:f>Sheet1!$B$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`
  const ser = series.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx>${str([s.name])}</c:tx><c:spPr><a:solidFill><a:schemeClr val="accent${i + 1}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/><c:cat>${str(cats)}</c:cat><c:val>${num(s.values)}</c:val></c:ser>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="219"/><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`
}

// ---------- The master, its layouts, the theme ----------
const SPTREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const lphPos = (type, idx, name, x, y, w, h, body = '', paras = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${type ? ` type="${type}"` : ''}${idx != null ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${x == null ? '' : xfrm(x, y, w, h)}</p:spPr><p:txBody><a:bodyPr${body}/><a:lstStyle/>${paras || `<a:p><a:r><a:rPr lang="en-US"/><a:t>${name}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>`}</p:txBody></p:sp>`
const lvl = (n, sz, bullet) => `<a:lvl${n}pPr marL="${228600 + (n - 1) * 457200}" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="${n === 1 ? 1000 : 500}"/></a:spcBef><a:buFont typeface="Arial" panose="020B0604020202020204"/><a:buChar char="${bullet}"/><a:defRPr sz="${sz * 100}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${n}pPr>`
function masterXml() {
  // The master's own: an accent band down the left of every slide that uses it.
  const band = `<p:sp><p:nvSpPr><p:cNvPr id="${nextId++}" name="Accent band"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${in2(0.18)}" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${SPTREE_HEAD}${lphPos('title', null, 'Title Placeholder 1', 0.92, 0.4, 11.5, 1.45, ' vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr', '<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>').replace('<a:bodyPr vert', '<a:bodyPr vert').replace('</a:bodyPr/>', '</a:bodyPr>')}${lphPos('body', 1, 'Text Placeholder 2', 0.92, 2.0, 11.5, 4.75, ' vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr', '<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Second level</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>').replace('</a:bodyPr/>', '</a:bodyPr>')}${lphPos('dt', 2, 'Date Placeholder 3', 0.92, 6.95, 3, 0.4, ' anchor="ctr"', '<a:p><a:fld id="{B1C5}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>11/8/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>')}${lphPos('ftr', 3, 'Footer Placeholder 4', 4.42, 6.95, 4.5, 0.4, ' anchor="ctr"', '<a:p><a:endParaRPr lang="en-US"/></a:p>')}${lphPos('sldNum', 4, 'Slide Number Placeholder 5', 9.42, 6.95, 3, 0.4, ' anchor="ctr"', '<a:p><a:pPr algn="r"/><a:fld id="{A2D3}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>')}${band}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst>${LAYOUTS.map((l, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" kern="1200"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>${lvl(1, 26, '•')}${lvl(2, 22, '–')}${lvl(3, 20, '•')}</p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
}
// Each layout: its name, its type, its placeholders (those with a place of their own; the rest
// take the master's).
const LAYOUTS = [
  { name: 'Title Slide', type: 'title', phs: () => [lphPos('ctrTitle', null, 'Title 1', 1.5, 1.6, 10.33, 2.4, ' anchor="b"><a:normAutofit/></a:bodyPr', '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="5400"/><a:t>Click to edit Master title style</a:t></a:r></a:p>').replace('</a:bodyPr/>', '</a:bodyPr>').replace('<a:lstStyle/>', '<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="5400"/></a:lvl1pPr></a:lstStyle>'), lphPos('subTitle', 1, 'Subtitle 2', 1.5, 4.2, 10.33, 1.6, '', '<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master subtitle style</a:t></a:r></a:p>').replace('<a:lstStyle/>', '<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>')] },
  { name: 'Title and Content', type: 'obj', phs: () => [lphPos('title', null, 'Title 1'), lphPos(null, 1, 'Content Placeholder 2')] },
  { name: 'Section Header', type: 'secHead', phs: () => [lphPos('title', null, 'Title 1', 0.92, 2.2, 11.5, 1.6, ' anchor="b"').replace('<a:lstStyle/>', '<a:lstStyle><a:lvl1pPr><a:defRPr sz="5400"/></a:lvl1pPr></a:lstStyle>'), lphPos('body', 1, 'Text Placeholder 2', 0.92, 3.9, 11.5, 1.2).replace('<a:lstStyle/>', '<a:lstStyle><a:lvl1pPr marL="0" indent="0"><a:buNone/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"><a:tint val="75000"/></a:schemeClr></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>')] },
  { name: 'Two Content', type: 'twoObj', phs: () => [lphPos('title', null, 'Title 1'), lphPos(null, 1, 'Content Placeholder 2', 0.92, 2.0, 5.6, 4.75), lphPos(null, 2, 'Content Placeholder 3', 6.82, 2.0, 5.6, 4.75)] },
  { name: 'Title Only', type: 'titleOnly', phs: () => [lphPos('title', null, 'Title 1')] },
  { name: 'Blank', type: 'blank', phs: () => [] },
]
function layoutXml(l) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout ${NS} type="${l.type}" preserve="1"><p:cSld name="${l.name}"><p:spTree>${SPTREE_HEAD}${l.phs().join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}
// The theme: Office's colour slots in a palette of their own, and its two fonts.
export function themeXml({ name = 'Northwind', major = 'Georgia', minor = 'Arial', accent1 = '2E6BD9' } = {}) {
  const c = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`
  const fills = '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  const lines = '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements><a:clrScheme name="${name}"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${c('dk2', '1F2A44')}${c('lt2', 'E8ECF2')}${c('accent1', accent1)}${c('accent2', 'E0803A')}${c('accent3', '7A9A3A')}${c('accent4', 'B8476B')}${c('accent5', '3A9AB8')}${c('accent6', '7B5BB0')}${c('hlink', '0563C1')}${c('folHlink', '954F72')}</a:clrScheme><a:fontScheme name="${name}"><a:majorFont><a:latin typeface="${major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office">${fills}${lines}<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}
const notesMasterXml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notesMaster ${NS}><p:cSld><p:spTree>${SPTREE_HEAD}${lphPos('sldImg', 2, 'Slide Image Placeholder 1', 1, 0.75, 5.5, 3.1)}${lphPos('body', 3, 'Notes Placeholder 2', 0.75, 4.1, 6, 4.9)}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`
const notesXml = (text) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes ${NS}><p:cSld><p:spTree>${SPTREE_HEAD}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${text.split('\n').map((l) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`

// ---------- The deck ----------
const LAYOUT_NO = Object.fromEntries(LAYOUTS.map((l, i) => [l.type, i + 1]))
// The slides of a board review, then "Region n" slides up to count.
export function boardSlides(count = 64) {
  const s = []
  s.push({ layout: 'title', notes: 'Welcome everyone.\nThank the board for the time.', shapes: [ph('ctrTitle', null, [p('Northwind Annual Review')], 'Title 1'), ph('subTitle', 1, [p('FY2026 · Board meeting')], 'Subtitle 2')] })
  s.push({ layout: 'obj', notes: 'Keep this to two minutes.', shapes: [ph('title', null, [p('Agenda')], 'Title 1'), ph(null, 1, [p('Where we are'), p('Revenue grew in every region', { lvl: 1 }), p('Two new products shipped', { lvl: 1 }), p('What changes next year'), p('Questions')], 'Content Placeholder 2')] })
  s.push({ layout: 'secHead', shapes: [ph('title', null, [p('Results')], 'Title 1'), ph('body', 1, [p('The year in numbers')], 'Text Placeholder 2')] })
  s.push({ layout: 'twoObj', shapes: [ph('title', null, [p('Before and after')], 'Title 1'), ph(null, 1, [p('Manual reports'), p('Weekly close')], 'Content Placeholder 2'), ph(null, 2, [p('Live dashboards'), p('Daily close')], 'Content Placeholder 3')] })
  s.push({ layout: 'titleOnly', notes: 'Walk through the flow left to right.', shapes: [ph('title', null, [p('How an order flows')], 'Title 1'),
    shape('Order', 0.9, 2.3, 2.6, 1.3, { geom: 'roundRect', fill: 'accent1', styled: true, anchor: 'ctr', paras: [p([r('Order', { color: 'FFFFFF', b: true, sz: 20 })], { algn: 'ctr' })] }),
    shape('Arrow 1', 3.7, 2.65, 1.2, 0.6, { geom: 'rightArrow', fill: 'accent2' }),
    shape('Check', 5.1, 2.1, 1.7, 1.7, { geom: 'ellipse', fill: 'accent3', anchor: 'ctr', paras: [p([r('Check', { color: 'FFFFFF', sz: 18 })], { algn: 'ctr' })] }),
    shape('Ship', 8.6, 2.2, 1.8, 1.5, { geom: 'triangle', fill: 'FFC000', line: '7F6000', rot: 15, anchor: 'b', paras: [p([r('Ship', { sz: 16 })], { algn: 'ctr' })] }),
    line('Connector 1', 6.9, 2.95, 8.4, 2.95, 'accent1'),
    shape('Note', 0.9, 4.6, 5.2, 1.2, { box: true, paras: [p([r('Orders over ', {}), r('$10k', { b: true, color: 'C00000' }), r(' go to a person first.', { i: true })])] }),
    shape('Flipped', 7.2, 4.4, 1.8, 1.2, { geom: 'rtTriangle', fill: 'accent5', flipH: true })] })
  s.push({ layout: 'titleOnly', shapes: [ph('title', null, [p('Grouped shapes')], 'Title 1'), group('Team', 1.5, 2.2, 6, 3, [shape('Lead', 0, 0, 4, 1, { geom: 'rect', fill: 'accent4', anchor: 'ctr', paras: [p([r('Lead', { color: 'FFFFFF' })], { algn: 'ctr' })] }), shape('Two', 0, 1.5, 1.8, 1, { fill: 'accent5', anchor: 'ctr', paras: [p([r('Design', { color: 'FFFFFF' })], { algn: 'ctr' })] }), shape('Three', 2.2, 1.5, 1.8, 1, { fill: 'accent6', anchor: 'ctr', paras: [p([r('Build', { color: 'FFFFFF' })], { algn: 'ctr' })] })], { x: 0, y: 0, w: 4, h: 2.5 })] })
  s.push({ layout: 'titleOnly', pictures: ['rIdPic'], shapes: [ph('title', null, [p('Our new office')], 'Title 1'), pic('Office photo', 'rIdPic', 1.2, 2.0, 6.4, 3.6, { l: 5, t: 0, r: 5, b: 10 }), shape('Caption', 8.0, 2.4, 4.2, 2, { box: true, paras: [p([r('Opened in March.', { sz: 20 })]), p([r('Room for 120 people.', { sz: 20, color: 'accent1' })])] })] })
  s.push({ layout: 'titleOnly', notes: 'The table is in the appendix too.', shapes: [ph('title', null, [p('By region')], 'Title 1'), table('Regions', 0.92, 2.0, 11.4, [['Region', 'Revenue', 'Growth'], ['North', '$4.2M', '+12%'], ['South', '$3.1M', '+8%'], ['West', '$5.6M', '+21%']])] })
  s.push({ layout: 'titleOnly', charts: ['rIdChart'], shapes: [ph('title', null, [p('Revenue by quarter')], 'Title 1'), frame('Chart 1', 'chart', 'rIdChart', 1.5, 1.9, 10, 4.8)] })
  s.push({ layout: 'titleOnly', shapes: [ph('title', null, [p('How we work')], 'Title 1'), frame('Diagram 1', 'diagram', 'rIdDgm', 1.5, 1.9, 10, 4.5)], diagram: true })
  s.push({ layout: 'obj', shapes: [ph('title', null, [p([r('Words in their own look', { color: 'accent2' })])], 'Title 1'), ph(null, 1, [
    p([r('Plain, '), r('bold', { b: true }), r(', '), r('italic', { i: true }), r(', '), r('underlined', { u: true }), r(' and '), r('red', { color: 'FF0000' })]),
    p([r('A bigger line in Courier New', { sz: 32, font: 'Courier New' })]),
    p([r('Centred, at one and a half lines')], { algn: 'ctr', lnSpc: 150 }),
    p([r('To the right')], { algn: 'r' }),
    p('First step', { num: true }), p('Second step', { num: true }),
  ], 'Content Placeholder 2')] })
  s.push({ layout: 'obj', shapes: [ph('title', null, [p('Too much to fit')], 'Title 1'), shape('Long', 0.92, 2.0, 11.5, 2.2, { autofit: 62.5, paras: Array.from({ length: 9 }, (_, i) => p(`A line that goes on, number ${i + 1}, to fill the box`, {})) })] })
  s.push({ layout: 'obj', hidden: true, notes: 'Hidden: only if asked.', shapes: [ph('title', null, [p('Backup: assumptions')], 'Title 1'), ph(null, 1, [p('Prices hold'), p('No new rules')], 'Content Placeholder 2')] })
  s.push({ layout: 'blank', shapes: [shape('Big', 1, 2.5, 11.3, 2, { box: true, paras: [p([r('Thank you', { sz: 60, b: true, color: 'accent1' })], { algn: 'ctr' })] })] })
  for (let n = s.length + 1; n <= count; n++) s.push({ layout: 'obj', notes: n % 3 ? '' : `Region ${n} notes`, shapes: [ph('title', null, [p(`Region ${n} results`)], 'Title 1'), ph(null, 1, [p(`Revenue up ${n % 9 + 2}%`), p(`${n * 3} new customers`), p('Hiring two people', { lvl: 1 })], 'Content Placeholder 2')] })
  return s
}

// The file's bytes. slides: from boardSlides, or your own; theme: themeXml's options.
export async function deckPptx({ slides = boardSlides(), theme = {} } = {}) {
  nextId = 2
  const z = new JSZip()
  const png = chartPng(480, 270)
  const types = []
  const over = (part, type) => types.push(`<Override PartName="/${part}" ContentType="${type}"/>`)
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  z.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><PresentationFormat>Widescreen</PresentationFormat></Properties>')
  z.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Northwind Annual Review</dc:title></cp:coreProperties>')
  over('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')
  over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
  z.file('ppt/theme/theme1.xml', themeXml(theme)); over('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml')
  z.file('ppt/theme/theme2.xml', themeXml({ name: 'Notes' })); over('ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml')
  z.file('ppt/slideMasters/slideMaster1.xml', masterXml()); over('ppt/slideMasters/slideMaster1.xml', `${CT}.slideMaster+xml`)
  z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${LAYOUTS.map((l, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout${i + 1}.xml"/>`).join('')}<Relationship Id="rId${LAYOUTS.length + 1}" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`)
  LAYOUTS.forEach((l, i) => {
    z.file(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(l)); over(`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${CT}.slideLayout+xml`)
    z.file(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`)
  })
  z.file('ppt/notesMasters/notesMaster1.xml', notesMasterXml()); over('ppt/notesMasters/notesMaster1.xml', `${CT}.notesMaster+xml`)
  z.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="../theme/theme2.xml"/></Relationships>`)
  z.file('ppt/media/image1.png', png)
  let charts = 0
  slides.forEach((s, i) => {
    const n = i + 1
    const rels = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout${LAYOUT_NO[s.layout] || 2}.xml"/>`]
    if (s.pictures) rels.push(`<Relationship Id="rIdPic" Type="${REL}/image" Target="../media/image1.png"/>`)
    if (s.charts) {
      charts++
      rels.push(`<Relationship Id="rIdChart" Type="${REL}/chart" Target="../charts/chart${charts}.xml"/>`)
      z.file(`ppt/charts/chart${charts}.xml`, chartXml('Revenue ($M)', ['Q1', 'Q2', 'Q3', 'Q4'], [{ name: '2025', values: [3.1, 3.4, 3.9, 4.2] }, { name: '2026', values: [3.6, 4.1, 4.4, 5.2] }]))
      over(`ppt/charts/chart${charts}.xml`, 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
    }
    if (s.notes) {
      rels.push(`<Relationship Id="rIdNotes" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`)
      z.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(s.notes)); over(`ppt/notesSlides/notesSlide${n}.xml`, `${CT}.notesSlide+xml`)
      z.file(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="${REL}/slide" Target="../slides/slide${n}.xml"/></Relationships>`)
    }
    z.file(`ppt/slides/slide${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${SPTREE_HEAD}${s.shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`)
    z.file(`ppt/slides/_rels/slide${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`)
    over(`ppt/slides/slide${n}.xml`, `${CT}.slide+xml`)
  })
  const presRels = [`<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`, `<Relationship Id="rId2" Type="${REL}/notesMaster" Target="notesMasters/notesMaster1.xml"/>`, `<Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/>`, `<Relationship Id="rId4" Type="${REL}/presProps" Target="presProps.xml"/>`, `<Relationship Id="rId5" Type="${REL}/viewProps" Target="viewProps.xml"/>`, `<Relationship Id="rId6" Type="${REL}/tableStyles" Target="tableStyles.xml"/>`, ...slides.map((_, i) => `<Relationship Id="rId${i + 10}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`)]
  z.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join('')}</Relationships>`)
  z.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`)
  over('ppt/presentation.xml', `${CT}.presentation.main+xml`)
  z.file('ppt/presProps.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentationPr ${NS}/>`); over('ppt/presProps.xml', `${CT}.presProps+xml`)
  z.file('ppt/viewProps.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`); over('ppt/viewProps.xml', `${CT}.viewProps+xml`)
  z.file('ppt/tableStyles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>'); over('ppt/tableStyles.xml', `${CT}.tableStyles+xml`)
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types.join('')}</Types>`)
  return new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}
