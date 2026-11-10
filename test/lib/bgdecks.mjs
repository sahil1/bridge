// PowerPoint files whose look comes from their backgrounds, masters, layouts and themes, for
// Studio's tests: one thing on each first slide (a master's picture, stretched and tiled; a
// layout's background over its master's; a slide's over both; solid colours, linear and radial
// gradients, see-through ones, a pattern; the theme's background styles by bgRef; a dark master
// whose colour map swaps light and dark; a picture or shape covering the slide from its master or
// layout; master graphics hidden by a slide and by a layout; the theme's fonts and the master's
// text styles), and decks as PowerPoint for Mac, Google Slides and Keynote write them. Each says
// what its slide should show at its corners and centre: [x, y (0 to 1 of the slide), colour, how
// far off it may be]. Made here from the XML itself, with pictures of a few pixels made here too.
import zlib from 'node:zlib'
import JSZip from 'jszip'

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.presentationml'
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const EMU = 914400
const in2 = (x) => Math.round(x * EMU)
const W = 1280, H = 720 // the slide in px (13.333 by 7.5 inches)

// ---------- Pictures ----------
const crcChunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]) }
// A PNG, w by h, each pixel's colour at(x, y) as 'RRGGBB'; its dots to the inch said in it.
export function png(w, h, at, dpi = 96) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = rgb(at(x, y)); raw.set(c, y * (w * 3 + 1) + 1 + x * 3) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const phys = Buffer.alloc(9); const ppm = Math.round(dpi / 0.0254); phys.writeUInt32BE(ppm, 0); phys.writeUInt32BE(ppm, 4); phys[8] = 1
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crcChunk('IHDR', ihdr), crcChunk('pHYs', phys), crcChunk('IDAT', zlib.deflateSync(raw)), crcChunk('IEND', Buffer.alloc(0))])
}
// The same as a TIFF (uncompressed), which PowerPoint shows and a browser mostly doesn't.
export function tiff(w, h, at) {
  const ifd = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, 0], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, h], [279, 4, 1, w * h * 3], [282, 5, 1, 0], [283, 5, 1, 0], [296, 3, 1, 2]]
  const ifdAt = 8, extra = ifdAt + 2 + ifd.length * 12 + 4
  const bps = extra, xres = extra + 6, yres = extra + 14, pixels = extra + 22
  const out = Buffer.alloc(pixels + w * h * 3)
  out.write('II', 0, 'latin1'); out.writeUInt16LE(42, 2); out.writeUInt32LE(ifdAt, 4); out.writeUInt16LE(ifd.length, ifdAt)
  ifd.forEach(([tag, type, count, value], k) => {
    const o = ifdAt + 2 + k * 12
    const v = tag === 258 ? bps : tag === 273 ? pixels : tag === 282 ? xres : tag === 283 ? yres : value
    out.writeUInt16LE(tag, o); out.writeUInt16LE(type, o + 2); out.writeUInt32LE(count, o + 4)
    if (type === 3 && count === 1) out.writeUInt16LE(v, o + 8); else out.writeUInt32LE(v, o + 8)
  })
  for (let k = 0; k < 3; k++) out.writeUInt16LE(8, bps + k * 2)
  for (const r of [xres, yres]) { out.writeUInt32LE(96, r); out.writeUInt32LE(1, r + 4) }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(rgb(at(x, y)), pixels + (y * w + x) * 3)
  return out
}
// A PNG read back (a screenshot, 8 bits a channel): { w, h, at(x, y): [r, g, b] }.
export function readPng(buf) {
  let i = 8, w = 0, h = 0, type = 0
  const data = []
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), name = buf.toString('latin1', i + 4, i + 8), body = buf.subarray(i + 8, i + 8 + len)
    if (name === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); type = body[9] }
    else if (name === 'IDAT') data.push(body)
    i += len + 12
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = w * bpp
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0
      px[y * stride + x] = (row[x] + pred) & 255
    }
  }
  return { w, h, at: (x, y) => { const o = Math.min(h - 1, Math.max(0, Math.round(y))) * stride + Math.min(w - 1, Math.max(0, Math.round(x))) * bpp; return bpp < 3 ? [px[o], px[o], px[o]] : [px[o], px[o + 1], px[o + 2]] } }
}
export const rgb = (hex) => [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16))
export const hexOf = (c) => c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
// Two colours mixed: t of the way from a to b.
export const mix = (a, b, t) => hexOf(rgb(a).map((v, k) => v + (rgb(b)[k] - v) * t))

// A picture in nine colours, three by three, so where each part of it is drawn shows: its corners
// and its centre each a colour of their own.
export const GRID = [['C0392B', 'E67E22', '27AE60'], ['16A085', '2980B9', '8E44AD'], ['F1C40F', '2C3E50', 'D35400']]
const gridPng = () => png(30, 30, (x, y) => GRID[Math.floor(y / 10)][Math.floor(x / 10)])
// What the grid shows at a point of the slide when it's stretched over all of it.
const gridAt = (fx, fy) => GRID[Math.min(2, Math.floor(fy * 3))][Math.min(2, Math.floor(fx * 3))]
// A tile: 32 px square (a third of an inch), in four colours.
export const TILE = { size: 32, colors: [['E74C3C', '3498DB'], ['2ECC71', 'F39C12']] }
const tilePng = () => png(32, 32, (x, y) => TILE.colors[y < 16 ? 0 : 1][x < 16 ? 0 : 1])
const tileAt = (x, y) => TILE.colors[(y % 32) < 16 ? 0 : 1][(x % 32) < 16 ? 0 : 1]

// ---------- Parts ----------
let nextId = 2
const nv = (name) => `<p:cNvPr id="${nextId++}" name="${name}"/>`
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${in2(x)}" y="${in2(y)}"/><a:ext cx="${in2(w)}" cy="${in2(h)}"/></a:xfrm>`
const SPTREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const para = (text, rPr = '') => `<a:p><a:r><a:rPr lang="en-US" dirty="0"${rPr}/><a:t>${text}</a:t></a:r></a:p>`
// A placeholder: its place (inches) or none (its layout's or master's), its words.
export const ph = (type, idx, at, words = '') => `<p:sp><p:nvSpPr>${nv(`${type || 'body'} ${idx ?? ''}`.trim())}<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph${type ? ` type="${type}"` : ''}${idx != null ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${at ? xfrm(...at) : ''}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${words ? para(words) : '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`
// A shape: its place in inches, its fill's XML (or none), its words in a colour of the theme.
const words = (text, color) => `<a:p><a:r><a:rPr lang="en-US" sz="2000" dirty="0">${color ? `<a:solidFill><a:schemeClr val="${color}"/></a:solidFill>` : ''}</a:rPr><a:t>${text}</a:t></a:r></a:p>`
export const rect = (name, at, fill, text = '', color = null) => `<p:sp><p:nvSpPr>${nv(name)}<p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr>${xfrm(...at)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill || '<a:noFill/>'}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/>${text ? words(text, color) : '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</p:txBody></p:sp>`
// A picture: its place in inches, its picture's relationship, and what's done to it (alphaModFix…).
export const picture = (name, at, rid, blipKids = '') => `<p:pic><p:nvPicPr>${nv(name)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr userDrawn="1"/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${blipKids}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(...at)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
export const solid = (hex, kids = '') => `<a:solidFill><a:srgbClr val="${hex}">${kids}</a:srgbClr></a:solidFill>`
export const scheme = (name, kids = '') => `<a:solidFill><a:schemeClr val="${name}">${kids}</a:schemeClr></a:solidFill>`
const bgPr = (fill) => `<p:bg><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`
const stretched = (rid, blipKids = '') => `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid}">${blipKids}</a:blip><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`
const grad = (stops, how) => `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stops.map(([pos, c]) => `<a:gs pos="${pos}">${c}</a:gs>`).join('')}</a:gsLst>${how}</a:gradFill>`
const srgb = (hex, kids = '') => `<a:srgbClr val="${hex}">${kids}</a:srgbClr>`

const CLRMAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"'
const DARK_MAP = CLRMAP.replace('bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"', 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"')
const COLORS = { dk1: '<a:sysClr val="windowText" lastClr="000000"/>', lt1: '<a:sysClr val="window" lastClr="FFFFFF"/>', dk2: srgb('0E2841'), lt2: srgb('E8E8E8'), accent1: srgb('4472C4'), accent2: srgb('ED7D31'), accent3: srgb('A5A5A5'), accent4: srgb('FFC000'), accent5: srgb('5B9BD5'), accent6: srgb('70AD47'), hlink: srgb('0563C1'), folHlink: srgb('954F72') }
// The theme's three background styles, as Office's own theme has them (idx 1001, 1002, 1003).
const OFFICE_BG = ['<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>', '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>', '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>']
function themeXml({ colors = {}, major = 'Calibri Light', minor = 'Calibri', bgFills = OFFICE_BG } = {}) {
  const c = { ...COLORS, ...colors }
  const fills = '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="50000"/></a:schemeClr></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  const lines = '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  return `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}" name="Test"><a:themeElements><a:clrScheme name="Test">${Object.keys(COLORS).map((k) => `<a:${k}>${c[k]}</a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="${major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office">${fills}${lines}<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${bgFills.join('')}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}
const TITLE_STYLE = '<p:titleStyle><a:lvl1pPr algn="l" rtl="0"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
const BODY_STYLE = '<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600" algn="l" rtl="0"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:bodyStyle>'
const OTHER_STYLE = '<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" rtl="0"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle>'
// Where the master's title and body are (inches): the title clear of the corners and the centre.
const TITLE_AT = [0.9, 0.45, 11.5, 1.2], BODY_AT = [0.9, 1.9, 11.5, 4.6]

// A deck: { theme, master: { bg, shapes, clrMap, titleStyle, bodyStyle, root, media }, layout: {
// bg, shapes, showMasterSp, media }, slide: { bg, shapes, showMasterSp, media }, media: { 'name':
// bytes }, app }. media on a part: [[rid, 'name']] its relationships to pictures in ppt/media.
export async function bgDeck({ theme = {}, master = {}, layout = {}, slide = {}, media = {}, app = 'Microsoft Office PowerPoint', themeMedia = [] } = {}) {
  nextId = 2
  const z = new JSZip()
  const types = []
  const over = (part, type) => types.push(`<Override PartName="/${part}" ContentType="${type}"/>`)
  const rels = (list) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`
  const pics = (list = []) => list.map(([id, name]) => [id, 'image', `../media/${name}`])
  z.file('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)
  z.file('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${app}</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>1</Slides></Properties>`)
  z.file('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Backgrounds</dc:title></cp:coreProperties>`)
  over('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')
  over('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
  for (const [name, bytes] of Object.entries(media)) z.file(`ppt/media/${name}`, bytes)
  z.file('ppt/theme/theme1.xml', themeXml(theme)); over('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml')
  if (themeMedia.length) z.file('ppt/theme/_rels/theme1.xml.rels', rels(pics(themeMedia)))
  const root = master.root || ''
  z.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}${root}><p:cSld>${master.bg ?? ''}<p:spTree>${SPTREE_HEAD}${ph('title', null, TITLE_AT, 'Click to edit Master title style')}${ph('body', 1, BODY_AT, 'Click to edit Master text styles')}${(master.shapes || []).join('')}</p:spTree>${master.cSldExt || ''}</p:cSld><p:clrMap ${master.clrMap || CLRMAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles>${master.titleStyle || TITLE_STYLE}${master.bodyStyle || BODY_STYLE}${OTHER_STYLE}</p:txStyles>${master.ext || ''}</p:sldMaster>`)
  over('ppt/slideMasters/slideMaster1.xml', `${CT}.slideMaster+xml`)
  z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml'], ...pics(master.media)]))
  const lroot = layout.root || ''
  z.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS}${lroot} type="${layout.type || 'title'}" preserve="1"${layout.showMasterSp === false ? ' showMasterSp="0"' : ''}><p:cSld name="${layout.name || 'Title Slide'}">${layout.bg ?? ''}<p:spTree>${SPTREE_HEAD}${ph('ctrTitle', null, null, 'Click to edit Master title style')}${ph('subTitle', 1, [0.9, 5.7, 11.5, 0.8], 'Click to edit Master subtitle style')}${(layout.shapes || []).join('')}</p:spTree>${layout.cSldExt || ''}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${layout.ext || ''}</p:sldLayout>`)
  over('ppt/slideLayouts/slideLayout1.xml', `${CT}.slideLayout+xml`)
  z.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml'], ...pics(layout.media)]))
  const sroot = slide.root || ''
  const onSlide = slide.words ?? [ph('ctrTitle', null, null, slide.title || 'Backgrounds'), ph('subTitle', 1, null, slide.subtitle || 'As the file has them')]
  z.file('ppt/slides/slide1.xml', `${XML}<p:sld ${NS}${sroot}${slide.showMasterSp === false ? ' showMasterSp="0"' : ''}><p:cSld>${slide.bg ?? ''}<p:spTree>${SPTREE_HEAD}${(slide.under || []).join('')}${onSlide.join('')}${(slide.shapes || []).join('')}</p:spTree>${slide.cSldExt || ''}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${slide.ext || ''}</p:sld>`)
  over('ppt/slides/slide1.xml', `${CT}.slide+xml`)
  z.file('ppt/slides/_rels/slide1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...pics(slide.media)]))
  z.file('ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'theme', 'theme/theme1.xml'], ['rId4', 'presProps', 'presProps.xml'], ['rId5', 'viewProps', 'viewProps.xml'], ['rId6', 'tableStyles', 'tableStyles.xml']]))
  z.file('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" rtl="0"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`)
  over('ppt/presentation.xml', `${CT}.presentation.main+xml`)
  z.file('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`); over('ppt/presProps.xml', `${CT}.presProps+xml`)
  z.file('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`); over('ppt/viewProps.xml', `${CT}.viewProps+xml`)
  z.file('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`); over('ppt/tableStyles.xml', `${CT}.tableStyles+xml`)
  z.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="tiff" ContentType="image/tiff"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types.join('')}</Types>`)
  return new Uint8Array(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

// ---------- The decks ----------
// Where a slide is looked at: its corners (a little in) and its centre.
export const SPOTS = [[0.03, 0.04], [0.97, 0.04], [0.03, 0.96], [0.97, 0.96], [0.5, 0.5]]
const each = (fn, tol = 10) => SPOTS.map(([x, y]) => [x, y, fn(x, y), tol])
// A linear gradient's colour at a point: from a to b along angle deg (0 left to right, 90 top to
// bottom); scaled, as if the slide were square.
const along = (a, b, deg, scaled, x, y) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t)
  const [w, h] = scaled ? [1, 1] : [W, H]
  const half = (w * Math.abs(c) + h * Math.abs(s)) / 2
  return mix(a, b, 0.5 + ((x - 0.5) * w * c + (y - 0.5) * h * s) / half / 2)
}
const blend = (top, alpha, under) => mix(under, top, alpha)

// Each: { name, about, spec (bgDeck's), spots, average (a spot's colour the mean around it, for a
// pattern), words (the colours and fonts of its title and body), unshown (its background can't be
// drawn in a browser) }. Its slide's title is its name, unless it has words of its own (mark: what
// its slide says, to know it's the one showing).
export function bgCases() {
  const grid = gridPng(), tile = tilePng()
  return CASES(grid, tile).map((c) => ({ ...c, mark: c.mark || c.name, spec: { ...c.spec, slide: { title: c.name, ...(c.spec.slide || {}) } } }))
}
const CASES = (grid, tile) => [
  {
    name: 'solid', about: 'a slide\'s own colour',
    spec: { slide: { bg: bgPr(solid('1F4E79')) } },
    spots: each(() => '1F4E79', 4),
  },
  {
    name: 'master-picture', about: 'a picture on the master, stretched over the slide',
    spec: { media: { 'image1.png': grid }, master: { bg: bgPr(stretched('rId3')), media: [['rId3', 'image1.png']] } },
    spots: each(gridAt, 12),
  },
  {
    name: 'master-tiled', about: 'a picture on the master, tiled from the top left',
    spec: { media: { 'image1.png': tile }, master: { bg: bgPr(`<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="rId3"/><a:srcRect/><a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/></a:blipFill>`), media: [['rId3', 'image1.png']] } },
    // Each spot in the middle of a quarter of a tile (each tile its 32 px, at the 96 dpi it says),
    // near the corners and the centre.
    spots: [[8, 8], [1256, 8], [8, 696], [1272, 696], [632, 360]].map(([x, y]) => [x / W, y / H, tileAt(x, y), 12]),
  },
  {
    name: 'layout-over-master', about: 'a layout\'s own background over its master\'s',
    spec: { master: { bg: bgPr(solid('B91C1C')) }, layout: { bg: bgPr(solid('065F46')) } },
    spots: each(() => '065F46', 4),
  },
  {
    name: 'slide-over-both', about: 'a slide\'s own background over its layout\'s and master\'s',
    spec: { media: { 'image1.png': grid }, master: { bg: bgPr(stretched('rId3')), media: [['rId3', 'image1.png']] }, layout: { bg: bgPr(grad([[0, srgb('000000')], [100000, srgb('FFFFFF')]], '<a:lin ang="0" scaled="0"/>')) }, slide: { bg: bgPr(solid('6D28D9')) } },
    spots: each(() => '6D28D9', 4),
  },
  {
    name: 'gradient-down', about: 'a linear gradient, top to bottom, in three stops',
    spec: { slide: { bg: bgPr(grad([[0, srgb('1E3A8A')], [50000, srgb('0EA5E9')], [100000, srgb('F97316')]], '<a:lin ang="5400000" scaled="1"/>')) } },
    spots: each((x, y) => (y < 0.5 ? mix('1E3A8A', '0EA5E9', y / 0.5) : mix('0EA5E9', 'F97316', (y - 0.5) / 0.5)), 14),
  },
  {
    name: 'gradient-diagonal', about: 'a linear gradient at 45 degrees, as PowerPoint\'s presets have it',
    spec: { slide: { bg: bgPr(grad([[0, srgb('0F766E')], [100000, srgb('FDE68A')]], '<a:lin ang="2700000" scaled="1"/>')) } },
    spots: each((x, y) => along('0F766E', 'FDE68A', 45, true, x, y), 16),
  },
  {
    name: 'gradient-radial', about: 'a radial gradient from the centre',
    spec: { slide: { bg: bgPr(grad([[0, srgb('FACC15')], [100000, srgb('7C2D12')]], '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path><a:tileRect/>')) } },
    // Its centre the first stop; its corners the last.
    spots: [[0.5, 0.5, 'FACC15', 14], [0.01, 0.015, '7C2D12', 40], [0.99, 0.985, '7C2D12', 40]],
  },
  {
    name: 'see-through', about: 'a colour and a gradient made see-through: over white',
    spec: { slide: { bg: bgPr(grad([[0, srgb('1D4ED8')], [100000, srgb('1D4ED8', '<a:alpha val="0"/>')]], '<a:lin ang="0" scaled="1"/>')) } },
    spots: each((x) => blend('1D4ED8', 1 - x, 'FFFFFF'), 16),
  },
  {
    name: 'solid-alpha', about: 'a colour 40% opaque, over white',
    spec: { slide: { bg: bgPr(solid('DC2626', '<a:alpha val="40000"/>')) } },
    spots: each(() => blend('DC2626', 0.4, 'FFFFFF'), 6),
  },
  {
    name: 'pattern', about: 'a pattern, half one colour and half the other',
    spec: { slide: { bg: bgPr('<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="1E3A8A"/></a:fgClr><a:bgClr><a:srgbClr val="FDE047"/></a:bgClr></a:pattFill>') } },
    spots: each(() => mix('1E3A8A', 'FDE047', 0.5), 30), average: true,
  },
  {
    name: 'bgref-solid', about: 'the theme\'s first background style (bgRef 1001) in a theme colour',
    spec: { master: { bg: '<p:bg><p:bgRef idx="1001"><a:schemeClr val="accent5"/></p:bgRef></p:bg>' } },
    spots: each(() => '5B9BD5', 4),
  },
  {
    name: 'bgref-gradient', about: 'Office\'s own third background style (bgRef 1003): a gradient from the theme colour',
    spec: { master: { bg: '<p:bg><p:bgRef idx="1003"><a:schemeClr val="accent1"/></p:bgRef></p:bg>' } },
    // Its stops, accent 1 (4472C4) made lighter and darker as PowerPoint works them out (tints and
    // shades in linear light): 4D7CE1, 3F71CF, 2B59AA, top to bottom (Quick Look draws their mean).
    spots: each((x, y) => (y < 0.5 ? mix('4D7CE1', '3F71CF', y / 0.5) : mix('3F71CF', '2B59AA', (y - 0.5) / 0.5)), 10),
  },
  {
    name: 'bgref-picture', about: 'a theme whose background style is a picture of its own',
    spec: { media: { 'image2.png': grid }, themeMedia: [['rId1', 'image2.png']], theme: { bgFills: [OFFICE_BG[0], OFFICE_BG[1], '<a:blipFill rotWithShape="1"><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>'] }, master: { bg: '<p:bg><p:bgRef idx="1003"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' } },
    spots: each(gridAt, 12),
  },
  {
    name: 'dark-master', about: 'a dark master: its colour map makes the background dk1 and the words lt1',
    spec: { theme: { colors: { dk1: srgb('111827'), dk2: srgb('1F2937'), lt2: srgb('D1D5DB') } }, master: { clrMap: DARK_MAP, bg: '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' }, slide: { shapes: [rect('Note', [0.9, 3.0, 5, 0.6], '', 'In tx2', 'tx2')] } },
    spots: each(() => '111827', 4), words: { title: 'FFFFFF' },
  },
  {
    name: 'master-full-picture', about: 'a picture covering the whole slide, on the master, as its background',
    spec: { media: { 'image1.png': grid }, master: { shapes: [picture('Background picture', [0, 0, 13.333333, 7.5], 'rId3')], media: [['rId3', 'image1.png']] } },
    spots: each(gridAt, 12),
  },
  {
    name: 'layout-full-shape', about: 'a shape covering the whole slide, on the layout',
    spec: { master: { bg: bgPr(solid('FFFFFF')) }, layout: { shapes: [rect('Backdrop', [0, 0, 13.333333, 7.5], scheme('accent1', '<a:lumMod val="50000"/>'))] } },
    spots: each(() => '203864', 6),
  },
  {
    name: 'slide-hides-master', about: 'a slide that hides its master\'s graphics (a shape over all of it)',
    spec: { master: { bg: bgPr(solid('FEF3C7')), shapes: [rect('Master band', [0, 0, 13.333333, 7.5], solid('7C3AED'))] }, slide: { showMasterSp: false } },
    spots: each(() => 'FEF3C7', 4),
  },
  {
    name: 'layout-hides-master', about: 'a layout that hides its master\'s graphics, keeping its own',
    spec: { master: { bg: bgPr(solid('FEF3C7')), shapes: [rect('Master band', [0, 0, 13.333333, 7.5], solid('7C3AED'))] }, layout: { showMasterSp: false, shapes: [rect('Layout bar', [4, 6.6, 5.3, 0.3], solid('0F766E'))] } },
    spots: each(() => 'FEF3C7', 4),
  },
  {
    name: 'theme-fonts', about: 'the theme\'s fonts and the master\'s title and body styles',
    spec: {
      theme: { major: 'Georgia', minor: 'Courier New' },
      master: { bg: bgPr(solid('F8FAFC')), titleStyle: TITLE_STYLE.replace('sz="4000"', 'sz="5400" b="1"').replace('<a:schemeClr val="tx1"/>', '<a:schemeClr val="accent2"/>') },
      slide: { words: [ph('ctrTitle', null, null, 'Georgia, bold, accent 2'), ph('subTitle', 1, null, 'Courier New, from the body')] },
    },
    spots: each(() => 'F8FAFC', 4), words: { title: 'ED7D31', titleFont: 'Georgia', bodyFont: 'Courier New' }, mark: 'Georgia, bold',
  },
  {
    name: 'mac', about: 'a deck as PowerPoint for Mac saves one: its master\'s picture with its extensions, alternate content, colours made lighter and darker',
    spec: {
      app: 'Microsoft Macintosh PowerPoint',
      media: { 'image1.png': grid },
      master: {
        root: ` ${MC} mc:Ignorable="p14"`,
        bg: `<p:bg><p:bgPr>${stretched('rId3', '<a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi val="0"/></a:ext></a:extLst>')}<a:effectLst/></p:bgPr></p:bg>`,
        media: [['rId3', 'image1.png']],
        shapes: [`<mc:AlternateContent><mc:Choice Requires="a14">${rect('Logo', [5.9, 6.75, 1.5, 0.5], scheme('accent1', '<a:lumMod val="40000"/><a:lumOff val="60000"/>'))}</mc:Choice><mc:Fallback>${rect('Logo', [5.9, 6.75, 1.5, 0.5], solid('B4C7E7'))}</mc:Fallback></mc:AlternateContent>`],
        cSldExt: '<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId val="2209977519"/></p:ext></p:extLst>',
      },
      layout: { root: ` ${MC} xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main" mc:Ignorable="p14 p15"`, cSldExt: '<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId val="1791263510"/></p:ext></p:extLst>', ext: '<p:extLst><p:ext uri="{DCECCB84-F9BA-43D5-87BE-67443E8EF086}"><p15:sldGuideLst><p15:guide id="1" orient="horz" pos="2160"/></p15:sldGuideLst></p:ext></p:extLst>' },
      slide: { root: ` ${MC} mc:Ignorable="p14"`, cSldExt: '<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId val="3157424271"/></p:ext></p:extLst>' },
    },
    spots: each(gridAt, 12),
  },
  {
    name: 'google', about: 'a deck as Google Slides exports one: the slide\'s own picture background',
    spec: {
      app: 'Google',
      media: { 'image1.png': grid },
      theme: { major: 'Arial', minor: 'Arial' },
      master: { bg: bgPr(scheme('lt1')) },
      slide: { bg: '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId3"><a:alphaModFix/></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg>', media: [['rId3', 'image1.png']] },
    },
    spots: each(gridAt, 12),
  },
  {
    name: 'keynote', about: 'a deck as Keynote exports one: a layout\'s gradient, and a picture half see-through over all of the slide',
    spec: {
      app: 'Keynote',
      media: { 'image1.png': grid },
      theme: { major: 'Helvetica Neue', minor: 'Helvetica Neue' },
      master: { bg: '' },
      layout: { bg: bgPr(grad([[0, srgb('0F172A')], [100000, srgb('0F172A')]], '<a:lin ang="5400000" scaled="0"/>')) },
      slide: { under: [picture('Image', [0, 0, 13.333333, 7.5], 'rId3', '<a:alphaModFix amt="50000"/>')], media: [['rId3', 'image1.png']] },
    },
    spots: each((x, y) => blend(gridAt(x, y), 0.5, '0F172A'), 14),
  },
  {
    name: 'tiff', about: 'a master\'s picture in a format the browser can\'t show (TIFF): its nearest, the theme\'s background colour, and said',
    spec: { theme: { colors: { lt1: srgb('E0F2FE') } }, media: { 'image1.tiff': tiff(30, 30, (x, y) => GRID[Math.floor(y / 10)][Math.floor(x / 10)]) }, master: { bg: bgPr(stretched('rId3')), media: [['rId3', 'image1.tiff']] } },
    spots: each(() => 'E0F2FE', 4), unshown: true,
  },
]
