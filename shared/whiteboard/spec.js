// A diagram as a model draws it for "Draw this" (server/boards.js) and an agent can hand over
// (bin/bridge board --file x.json): boxes and icons from the catalog, arrows between them, and
// containers (a region, a network, a subnet, a lane) that hold them. The board lays it out and
// draws it (src/components/whiteboard/spec.js). Small and flat, so a small model on this computer
// can write it too.
//   { "direction": "LR" | "TB",
//     "groups": [{ "id": "vpc", "label": "VPC", "kind": "vpc", "parent": "region" }],
//     "nodes":  [{ "id": "lb", "label": "Load balancer", "shape": "aws.elb", "group": "vpc" }],
//     "edges":  [{ "from": "lb", "to": "app", "label": "HTTPS", "style": "dashed" }] }
// A sequence of messages doesn't fit boxes and arrows: then "mermaid" holds a Mermaid
// sequenceDiagram instead, and nodes stay empty.
import { itemFor, CONTAINER_KINDS } from './catalog.js'

export const LIMITS = { nodes: 80, edges: 160, groups: 30, label: 60 }

// For providers that take a JSON Schema for the answer (OpenAI, Ollama, LM Studio): what the
// answer must look like. Loose on purpose (shapes are any words, read with itemFor), so a model
// is never forced into a wrong one.
export const SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['LR', 'TB'] },
    groups: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' }, parent: { type: 'string' } }, required: ['id', 'label'] } },
    nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, shape: { type: 'string' }, group: { type: 'string' } }, required: ['id', 'label'] } },
    edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, style: { type: 'string', enum: ['solid', 'dashed'] } }, required: ['from', 'to'] } },
    mermaid: { type: 'string' },
  },
  required: ['nodes', 'edges'],
}

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()
const label = (v) => { const s = str(v); return s.length > LIMITS.label ? `${s.slice(0, LIMITS.label - 1)}…` : s }

// A model's answer made safe to draw: { spec } or { mermaid }, with what was wrong but could be
// mended in problems (an arrow to a box that isn't there, a group in a loop), or { error } when
// there's nothing to draw, said so the model can be asked again.
export function readSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The answer was not a JSON object.' }
  const problems = []
  const nodesIn = Array.isArray(raw.nodes) ? raw.nodes : []
  if (!nodesIn.length && typeof raw.mermaid === 'string' && /^\s*(%%[^\n]*\n\s*)*(sequenceDiagram|flowchart|graph|classDiagram)\b/.test(raw.mermaid)) return { mermaid: raw.mermaid.trim(), problems }
  if (!nodesIn.length) return { error: 'It had no nodes: give at least one in "nodes".' }
  const taken = new Set()
  const idOf = (v) => str(v).slice(0, 60)
  const groups = []
  for (const g of (Array.isArray(raw.groups) ? raw.groups : []).slice(0, LIMITS.groups)) {
    const id = idOf(g?.id)
    if (!id || taken.has(id)) { problems.push(`a group without a unique id (${id || 'none'}) was left out`); continue }
    taken.add(id)
    const kind = str(g.kind).toLowerCase()
    groups.push({ id, label: label(g.label ?? id), kind: CONTAINER_KINDS.includes(kind) ? kind : itemFor(kind)?.kind === 'container' ? itemFor(kind).id : 'group', parent: idOf(g.parent) || null })
  }
  // A parent that isn't a group, or a loop of parents, is dropped.
  const gid = new Set(groups.map((g) => g.id))
  for (const g of groups) if (g.parent && (!gid.has(g.parent) || g.parent === g.id)) { problems.push(`group "${g.id}" names a parent that isn't a group`); g.parent = null }
  for (const g of groups) {
    const seen = new Set([g.id])
    for (let p = g.parent; p; p = groups.find((x) => x.id === p)?.parent) {
      if (seen.has(p)) { problems.push(`groups "${g.id}" and "${p}" are inside each other`); g.parent = null; break }
      seen.add(p)
    }
  }
  const nodes = []
  for (const n of nodesIn.slice(0, LIMITS.nodes)) {
    const id = idOf(n?.id ?? n?.label)
    if (!id || taken.has(id)) { problems.push(`a node without a unique id (${id || 'none'}) was left out`); continue }
    taken.add(id)
    const it = itemFor(n.shape)
    if (n.shape && !it) problems.push(`shape "${str(n.shape)}" isn't one of the shapes, so "${id}" is a box`)
    const group = idOf(n.group)
    if (group && !gid.has(group)) problems.push(`node "${id}" names a group that isn't there`)
    nodes.push({ id, label: label(n.label ?? id), shape: it && it.kind !== 'container' && it.kind !== 'lanes' ? it.id : 'process', group: gid.has(group) ? group : null })
  }
  if (!nodes.length) return { error: 'None of its nodes had an id.' }
  if (nodesIn.length > LIMITS.nodes) problems.push(`only the first ${LIMITS.nodes} nodes were kept`)
  const nid = new Set(nodes.map((n) => n.id))
  const edges = []
  for (const e of (Array.isArray(raw.edges) ? raw.edges : []).slice(0, LIMITS.edges)) {
    const from = idOf(e?.from), to = idOf(e?.to)
    if (!nid.has(from) || !nid.has(to)) { problems.push(`an edge from "${from}" to "${to}" names a node that isn't there`); continue }
    edges.push({ from, to, label: label(e.label), style: e.style === 'dashed' ? 'dashed' : 'solid' })
  }
  const d = str(raw.direction).toUpperCase()
  return { spec: { direction: d === 'TB' || d === 'TD' || d === 'BT' ? 'TB' : d === 'LR' || d === 'RL' ? 'LR' : null, groups, nodes, edges }, problems }
}
