import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { AssistHead } from '../AiAssist.jsx'
import { usePersisted } from '../layout.jsx'
import { api, usePoll, fmtRelative } from '../../api.js'
import { t, tx } from '../../i18n/index.js'
import { defaultKey, keyLabel } from '../../../shared/dictation/keys.js'
import { fromMermaid, placeBeside, describe, applyOps, groupBy } from './convert.js'
import { fromSpec } from './spec.js'
import { reroute, layoutBoard, fitInView } from './layout.js'
import { review } from './review.js'
import { solidBackground, fontsReady } from './look.js'
import { before, mark, markOne, keep as keepIt, discard as discardIt } from './suggest.js'
import { holderOf, contents } from './holders.js'
import CopyButton from '../CopyButton.jsx'

// "Draw this", "Change it" and "Ask" (about the shapes selected, answered here and changing
// nothing): words (typed, or said with the dictation key) to a model, and back
// as shapes on the board: a suggestion, marked on the board (suggest.js) to keep or discard there
// or here, which ⌘Z takes back too. Drawing can also start from a meeting, a project or an agent's
// work. The model is yours (models()): what it's sent is said under the button.
//   Refine: after the first drawing the model looks over its own work and improves it, up to the
// number of rounds picked. Each round the board is checked here (review.js: overlaps, crossings,
// arrows with no words…), and a model that can see gets a picture of it too. It stops early once
// there's nothing left to fix. Every round is kept as a version to step back to, with what changed
// and why, and the calls it took are counted. The last Refine is kept beside the board too
// (server/boards.js), so coming back to it later, its versions can still be put on the board.
// The meeting moves: a timeline with owners and dates, and the action items for each person (which
// go onto the Chief of Staff's task list with a click), drawn from what's on the board or a meeting;
// and Change it's Group by theme (themes()).
export const KINDS = [['auto', tx('Any kind')], ['flowchart', tx('Flowchart')], ['architecture', tx('Architecture')], ['network', tx('Network')], ['sequence', tx('Sequence')], ['org', tx('Org chart')], ['mindmap', tx('Mind map')], ['timeline', tx('Timeline')], ['actions', tx('Action items')]]
const FROM = [['', tx('Just my words')], ['board', tx("What's on this board")], ['meeting', tx('A meeting')], ['project', tx('A project')], ['agent', tx("An agent's work")]]
const ROUNDS = [0, 1, 2, 3, 4, 5]

// The model to draw with: the one picked here before, else the one meeting notes use.
export function useBoardModels() {
  const [list, setList] = useState(null)
  const [saved, setSaved] = usePersisted('cc-board-model', '')
  useEffect(() => { api('/boards/models').then(setList).catch(() => setList({ models: [], pick: null })) }, [])
  const models = list?.models || []
  const id = models.some((m) => m.id === saved) ? saved : list?.pick || models[0]?.id || ''
  return { loaded: !!list, models, id, model: models.find((m) => m.id === id) || null, pick: setSaved }
}

// What can be drawn from, for the second list.
function useChoices(from) {
  const [items, setItems] = useState(null)
  useEffect(() => {
    setItems(null)
    if (!from || from === 'board') return
    const get = from === 'meeting' ? api('/meetings').then((r) => (r.meetings || []).filter((m) => !m.archived).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 40).map((m) => ({ id: m.id, label: `${m.title} · ${new Date(m.startedAt).toLocaleDateString()}` })))
      : from === 'project' ? api('/projects').then((r) => (r.projects || []).map((p) => ({ id: p.path, label: p.name })))
        : api('/fleet').then((f) => (f.agents || []).filter((a) => !a.chief && !a.cloud && !a.shellTab).map((a) => ({ id: a.paneId, label: `${a.title || a.kind}${a.workspace ? ` · ${a.workspace}` : ''}` })))
    get.then(setItems).catch(() => setItems([]))
  }, [from])
  return items
}

// Where the words go, said plainly before anything is sent.
function goesTo(model, from, refine) {
  if (!model) return ''
  const what = from === 'board' ? t('Your words and what\'s written on the board') : from === 'meeting' ? t('Your words and the meeting') : from === 'project' ? t("Your words and the project's file names and README") : from === 'agent' ? t("Your words and the agent's conversation") : t('Your words')
  const base = model.via === 'local' ? t('{what} stay on this computer ({model}).', { what, model: model.label }) : t('{what} go to {model} ({provider}). Nothing else leaves this computer.', { what, model: model.label, provider: model.provider || model.label })
  return refine && model.via !== 'local' ? `${base} ${t('Refine sends it the drawing as well, and a picture of the board when it can look at one.')}` : base
}

// And for Ask: the shapes selected, or the whole board, with a picture where the model can see.
function goesAsk(model, sel) {
  if (!model) return ''
  const what = sel ? t('Your words and the shapes selected') : t('Your words and the board')
  return model.via === 'local' ? t('{what} stay on this computer ({model}).', { what, model: model.label }) : `${t('{what} go to {model} ({provider}). Nothing else leaves this computer.', { what, model: model.label, provider: model.provider || model.label })} ${t('With a picture of them, when it can look at one.')}`
}

const toDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob) })
const ISSUE = { overlap: tx('shapes on top of each other ({n})'), crossing: tx('crossing arrows ({n})'), unlabeled: tx('arrows without a label ({n})'), sizes: tx('uneven sizes'), cramped: tx('shapes too close ({n})'), spacing: tx('uneven gaps'), colours: tx('too many colours ({n})'), straddle: tx('half in a container ({n})') }
const say = (issues) => issues.map((x) => t(ISSUE[x.kind] || x.kind, { n: x.n })).join(', ')

// board: { X, api } of the drawing on screen. start: a drawing asked for before the board opened
// ({ prompt, kind, from, model, refine }), drawn straight away. boardId: the board's name, to keep
// its rounds by. look: the board's look. prefs: what the whiteboard has learnt (colours, spacing,
// direction). onDrawn({ ids, direction }): after a model has drawn, for learning from the edits
// that follow. want: { mode, n }, the way AI Assist's menu asked for (Draw this, Change it or Ask),
// or a meeting move to make straight away (themes, timeline, actions).
const modeOf = (w) => (w === 'themes' ? 'change' : w === 'timeline' || w === 'actions' ? 'draw' : w)
export default function DrawPanel({ board, start, want = null, onStarted, onClose, compact = false, boardId = null, look = 'clean', prefs = null, onDrawn }) {
  const els = board.api?.getSceneElements() || []
  const [mode, setMode] = useState(start ? 'draw' : modeOf(want?.mode) || (els.length ? 'change' : 'draw'))
  const [text, setText] = useState(start?.prompt || '')
  const [actions, setActions] = useState(null) // action items drawn: { items: [title], busy, added, error }
  const [kind, setKind] = usePersisted('cc-board-kind', 'auto')
  const [refine, setRefine] = usePersisted('cc-board-refine', 2)
  const [from, setFrom] = useState(start?.from ? Object.keys(start.from)[0] : '')
  const [fromId, setFromId] = useState(start?.from ? Object.values(start.from)[0] : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  const [run, setRun] = useState(null) // { rounds: [{ label, scene, changes, issues, saw }], at, calls, status, stop, round, of, step }
  const [past, setPast] = useState(null) // the last Refine kept beside the board: { prompt, mode, at, calls, rounds, pick }
  const stopRef = useRef(false)
  const m = useBoardModels()
  const choices = useChoices(mode === 'draw' ? from : '')
  const box = useRef(null)
  const form = useRef(null)
  const ran = useRef(false)
  const [answer, setAnswer] = useState(null) // Ask's: { text, shapes: [{ id, label }], model, saw }
  // How much is on the board and how much is selected, kept up as you draw; whether the last
  // suggestion made here still waits on the board, and how many wait in all, for Keep all (the
  // board's own bar is under this panel while it's open).
  const [sug, setSug] = useState(null) // the last suggestion made here: { id, by }
  const sugRef = useRef(null)
  sugRef.current = sug
  const count = (elements, appState) => {
    const ids = new Set(elements.filter((e) => !e.isDeleted && e.customData?.bridge?.suggestion?.id).map((e) => e.customData.bridge.suggestion.id))
    return { n: elements.filter((e) => !e.isDeleted).length, sel: Object.values(appState?.selectedElementIds || {}).filter(Boolean).length, waits: !!sugRef.current && ids.has(sugRef.current.id), sugs: ids.size }
  }
  const [scene, setScene] = useState(() => count(els, board.api?.getAppState()))
  useEffect(() => board.api?.onChange((elements, appState) => { const c = count(elements, appState); setScene((x) => (x.n === c.n && x.sel === c.sel && x.waits === c.waits && x.sugs === c.sugs ? x : c)) }), [board.api])
  useEffect(() => { const ex = board.api; if (ex) setScene(count(ex.getSceneElements(), ex.getAppState())) }, [sug]) // eslint-disable-line react-hooks/exhaustive-deps
  const sel = scene.sel
  // Dictation's key (Settings › Voice), to say what to draw.
  const dict = usePoll('/config', 10 * 60 * 1000).data?.dictation
  const platform = window.bridgeApp?.platform || (/Mac|iPhone|iPad/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux')
  const dictKey = dict?.on === false ? null : keyLabel(dict?.key || defaultKey(platform), platform)
  const undo = platform === 'darwin' ? '⌘Z' : 'Ctrl+Z'
  const rounds = Math.max(0, Math.min(5, Number(refine) || 0))
  const p = prefs?.on ? prefs.prefs || {} : {}
  const drawOpts = { look, scheme: p.colours?.value || 'soft', spacing: p.spacing?.value || 'normal', dir: p.direction?.value || null }

  useEffect(() => { box.current?.focus() }, [mode])
  useEffect(() => { if (from && choices?.length && !choices.some((c) => c.id === fromId)) setFromId(choices[0].id) }, [choices]) // eslint-disable-line react-hooks/exhaustive-deps

  // The board as it is now, to step back to.
  const keep = () => board.api.getSceneElementsIncludingDeleted().map((e) => ({ ...e }))
  // A picture of part of the board, for a model that can see.
  const picture = async (ids) => {
    const { X, api: ex } = board
    const pick = ex.getSceneElements().filter((e) => !ids || ids.has(e.id) || ids.has(e.containerId))
    const blob = await X.exportToBlob({ elements: pick, appState: { ...solidBackground(ex.getAppState()), exportBackground: true, exportWithDarkMode: false }, files: ex.getFiles(), mimeType: 'image/png', maxWidthOrHeight: 1280, exportPadding: 24 })
    return toDataUrl(blob)
  }
  const sees = async (model) => (await api(`/boards/sees?model=${encodeURIComponent(model || '')}`).catch(() => ({ sees: false }))).sees
  const saveRounds = (o) => { if (boardId) api(`/boards/${encodeURIComponent(boardId)}/rounds`, { method: 'PUT', body: o }).catch(() => {}) }

  // What a model drew, in view beside this panel (or below it on a phone) rather than under it, and
  // across the whole board once the panel closes.
  const fit = (elements) => {
    const { X, api: ex } = board
    const stage = form.current?.closest('.wb-stage')?.getBoundingClientRect()
    const me = form.current?.getBoundingClientRect()
    fitInView(X, ex, elements, stage && me ? (me.left > stage.left + stage.width / 2 ? { right: stage.right - me.left } : { top: me.bottom - stage.top }) : {})
  }
  const drawnIds = useRef(null)
  const boardRef = useRef(board)
  boardRef.current = board
  useEffect(() => () => {
    const { X, api: ex } = boardRef.current
    const ids = drawnIds.current
    if (ex && ids) try { fitInView(X, ex, ex.getSceneElements().filter((e) => ids.has(e.id))) } catch { /* the board is gone too */ }
  }, [])

  // A model's diagram on the board: where the last one was (a round of Refine), else beside what's
  // there or where you're looking, marked as suggestion s ({ id, by }). Returns the ids put there.
  const put = (got, replace = null, s = null) => {
    const { X, api: ex } = board
    const { width, height, scrollX, scrollY, zoom } = ex.getAppState()
    const view = { x: -scrollX + width / 2 / zoom.value, y: -scrollY + height / 2 / zoom.value }
    let placed
    let all = ex.getSceneElementsIncludingDeleted()
    if (replace?.size) {
      const was = all.filter((e) => replace.has(e.id) && !e.isDeleted)
      const [x1, y1] = X.getCommonBounds(was.length ? was : got.elements)
      const [gx, gy] = X.getCommonBounds(got.elements)
      placed = got.elements.map((e) => X.newElementWith(e, { x: e.x + x1 - gx, y: e.y + y1 - gy }))
      all = all.map((e) => (replace.has(e.id) ? X.newElementWith(e, { isDeleted: true }) : e))
    } else placed = placeBeside(X, got.elements, ex.getSceneElements(), view)
    if (s) placed = placed.map((e) => markOne(X, e, s))
    if (Object.keys(got.files || {}).length) ex.addFiles(Object.values(got.files))
    ex.updateScene({
      elements: [...all, ...placed],
      appState: { selectedElementIds: {} },
      captureUpdate: X.CaptureUpdateAction.IMMEDIATELY,
    })
    reroute(X, ex, placed.filter((e) => e.elbowed).map((e) => e.id))
    if (!replace) fit(placed)
    return new Set(placed.map((e) => e.id))
  }

  const draw = async (o = {}) => {
    const { X, api: ex } = board
    const prompt = (o.prompt ?? text).trim()
    const src = o.from || (from === 'board' ? { board: describe(ex.getSceneElements()) } : from && fromId ? { [from]: fromId } : null)
    const want = o.refine ?? rounds
    if (!prompt && !src) { setErr(t('Say what to draw')); return }
    setBusy(true); setErr(null); setNote(null); setPast(null); setActions(null); stopRef.current = false
    try {
      const body = { prompt, kind: o.kind || kind, from: src, model: o.model || m.id || undefined }
      setRun({ rounds: [], at: 0, calls: 0, status: 'running', step: 'draft', round: 0, of: want })
      let r = await api('/boards/draw', { method: 'POST', body })
      let calls = r.calls || 1
      await fontsReady(look)
      let got
      if (r.spec) got = fromSpec(X, r.spec, drawOpts)
      else {
        // Mermaid that doesn't draw goes back to the model once, with why.
        try { got = await fromMermaid(X, r.mermaid, look) } catch (e) {
          r = await api('/boards/draw', { method: 'POST', body: { ...body, again: { mermaid: r.mermaid, error: e.message } } })
          calls += r.calls || 1
          got = await fromMermaid(X, r.mermaid, look)
        }
      }
      if (!got.elements.length) throw new Error(t('The model sent back an empty diagram. Try again, or say it another way.'))
      const s = newSuggestion(labelOf(m, r.model))
      let ids = put(got, null, s)
      drawnIds.current = ids
      const versions = [{ label: t('Draft'), scene: keep(), changes: [], issues: [], spec: r.spec || null }]
      setRun({ rounds: versions.slice(), at: 0, calls, status: 'running', step: 'review', round: 1, of: want })
      let spec = r.spec
      let stopped = want ? 'rounds' : ''
      // Refine: only a spec can be redrawn as a whole; Mermaid (a sequence) is kept as drawn.
      const canSee = spec && want ? await sees(r.model) : false
      for (let i = 1; spec && i <= want; i++) {
        if (stopRef.current) { stopped = 'you'; break }
        const found = review(ex.getSceneElements(), ids)
        if (!found.length && !canSee) { stopped = 'clean'; break }
        setRun((x) => ({ ...x, step: canSee ? 'look' : 'check', round: i, found: say(found) }))
        const image = canSee ? await picture(ids).catch(() => null) : null
        const rv = await api('/boards/review', { method: 'POST', body: { mode: 'draw', prompt: prompt || r.title, spec, issues: found.map((x) => x.text), image, model: r.model, kind: body.kind } })
        calls += rv.calls || 1
        if (stopRef.current) { stopped = 'you'; break }
        if (rv.done) { stopped = 'fine'; setRun((x) => ({ ...x, calls })); break }
        spec = rv.spec
        ids = put(fromSpec(X, spec, drawOpts), ids, s)
        drawnIds.current = ids
        versions.push({ label: t('Round {n}', { n: i }), scene: keep(), changes: rv.changes || [], issues: found.map((x) => x.text), found: say(found), saw: rv.saw, spec })
        setRun((x) => ({ ...x, rounds: versions.slice(), at: versions.length - 1, calls }))
      }
      // Nothing refined (Refine off, or a sequence diagram, which comes as Mermaid): no rounds to show.
      setRun((x) => (want && r.spec ? { ...x, rounds: versions.slice(), at: versions.length - 1, calls, status: 'done', stop: stopped, model: r.model } : null))
      if (want && r.spec) saveRounds({ prompt, mode: 'draw', model: r.model, calls, stopped, rounds: versions.map((v, n) => ({ n, changes: v.changes, issues: v.issues, saw: v.saw, spec: v.spec })) })
      if (versions.length > 1) fit(ex.getSceneElements().filter((e) => ids.has(e.id)))
      onDrawn?.({ ids, direction: spec?.direction || drawOpts.dir || 'LR' })
      setSug(s)
      setNote(t('Drawn by {model}, as a suggestion: keep it or discard it, here or on the board.', { model: labelOf(m, r.model) }))
      setText('')
      // Action items: each one ("Priya: Fix the login bug · Friday"), to put on the task list.
      if (body.kind === 'actions' && spec) {
        const who = new Map((spec.groups || []).map((g) => [g.id, g.label]))
        const items = (spec.nodes || []).filter((n) => n.label).map((n) => (who.get(n.group) ? `${who.get(n.group)}: ${n.label}` : n.label))
        setActions(items.length ? { items } : null)
      } else setActions(null)
    } catch (e) { setErr(e.message); setRun((x) => (x && x.rounds.length ? { ...x, status: 'done', stop: 'error' } : null)) } finally { setBusy(false) }
  }
  // The action items onto the Chief of Staff's task list, as its Tasks panel adds them.
  const toTasks = async () => {
    if (!actions || actions.busy || actions.added) return
    setActions((a) => ({ ...a, busy: true, error: null }))
    let n = 0
    try {
      for (const title of actions.items) { await api('/chief/tasks', { method: 'POST', body: { title } }); n++ }
      setActions((a) => ({ ...a, busy: false, added: n }))
    } catch (e) { setActions((a) => ({ ...a, busy: false, added: n || null, error: e.message })) }
  }

  // "Group these notes by theme": the notes selected (or all of them) gathered in a box per theme,
  // as a suggestion like any other change (moved back where they were if it's discarded).
  const themes = async () => {
    const { X, api: ex } = board
    setBusy(true); setErr(null); setNote(t('Grouping the notes by theme…')); setAnswer(null); setActions(null); setRun(null)
    try {
      const all = ex.getSceneElements()
      const picked = new Set(Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, on]) => on).map(([id]) => id))
      for (const e of all) if (picked.has(e.id) && holderOf(e)) contents(e, all).forEach((c) => picked.add(c.id))
      const base = before(ex.getSceneElementsIncludingDeleted())
      const r = await api('/boards/themes', { method: 'POST', body: { scene: describe(all, picked.size ? picked : null), selected: picked.size > 0, model: m.id || undefined } })
      await fontsReady(look)
      const s = newSuggestion(labelOf(m, r.model))
      const { elements, touched } = groupBy(X, ex.getSceneElementsIncludingDeleted(), r.groups, look)
      ex.updateScene({ elements: mark(X, base, elements, s), appState: { selectedElementIds: {} }, captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
      fit(ex.getSceneElements().filter((e) => touched.includes(e.id)))
      setSug(s)
      setNote(t('Grouped into {n} themes by {model}, as a suggestion: keep it or discard it, here or on the board.', { n: r.groups.length, model: labelOf(m, r.model) }))
    } catch (e) { setNote(null); setErr(e.message) } finally { setBusy(false) }
  }

  const change = async () => {
    const { X, api: ex } = board
    const prompt = text.trim()
    if (!prompt) { setErr(t('Say what to change')); return }
    setBusy(true); setErr(null); setNote(null); setPast(null); stopRef.current = false
    try {
      const picked = new Set(Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, on]) => on).map(([id]) => id))
      const versions = [{ label: t('Before'), scene: keep(), changes: [], issues: [] }]
      setRun(rounds ? { rounds: [], at: 0, calls: 0, status: 'running', step: 'change', round: 0, of: rounds } : null)
      const base = before(ex.getSceneElementsIncludingDeleted())
      const r = await api('/boards/change', { method: 'POST', body: { prompt, scene: describe(ex.getSceneElements(), picked.size ? picked : null), selected: picked.size > 0, model: m.id || undefined } })
      let calls = r.calls || 1
      const s = newSuggestion(labelOf(m, r.model))
      // Each round's steps marked as one suggestion, against the board as it was before them.
      const doOps = (ops) => {
        const { elements, touched } = applyOps(X, ex.getSceneElementsIncludingDeleted(), ops, look)
        ex.updateScene({ elements: mark(X, base, elements, s), appState: { selectedElementIds: Object.fromEntries(touched.map((id) => [id, true])) }, captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
        reroute(X, ex, elements.filter((e) => e.elbowed && touched.includes(e.id)).map((e) => e.id))
        if (ops.layout) layoutBoard(X, ex, { dir: ops.layout, spacing: drawOpts.spacing })
        return touched
      }
      const n = r.ops.update.length + r.ops.add.length + r.ops.connect.length + r.ops.remove.length + (r.ops.layout ? 1 : 0)
      if (!n) { setNote(t('{model} found nothing to change.', { model: labelOf(m, r.model) })); setRun(null); return }
      await fontsReady(look)
      let touched = doOps(r.ops)
      versions.push({ label: t('Change'), scene: keep(), changes: [], issues: [] })
      setRun(rounds ? { rounds: versions.slice(), at: 1, calls, status: 'running', step: 'review', round: 1, of: rounds } : null)
      let stopped = rounds ? 'rounds' : ''
      const canSee = rounds ? await sees(r.model) : false
      const scope = () => (picked.size ? new Set([...picked, ...touched]) : null)
      for (let i = 1; i <= rounds; i++) {
        if (stopRef.current) { stopped = 'you'; break }
        const found = review(ex.getSceneElements(), scope())
        if (!found.length && !canSee) { stopped = 'clean'; break }
        setRun((x) => ({ ...x, step: canSee ? 'look' : 'check', round: i, found: say(found) }))
        const image = canSee ? await picture(scope()).catch(() => null) : null
        const rv = await api('/boards/review', { method: 'POST', body: { mode: 'change', prompt, scene: describe(ex.getSceneElements(), scope()), selected: picked.size > 0, issues: found.map((x) => x.text), image, model: r.model } })
        calls += rv.calls || 1
        if (stopRef.current) { stopped = 'you'; break }
        if (rv.done) { stopped = 'fine'; break }
        touched = [...new Set([...touched, ...doOps(rv.ops)])]
        versions.push({ label: t('Round {n}', { n: i }), scene: keep(), changes: rv.changes || [], issues: found.map((x) => x.text), found: say(found), saw: rv.saw })
        setRun((x) => ({ ...x, rounds: versions.slice(), at: versions.length - 1, calls }))
      }
      if (rounds) {
        setRun((x) => ({ ...x, rounds: versions.slice(), at: versions.length - 1, calls, status: 'done', stop: stopped, model: r.model }))
        saveRounds({ prompt, mode: 'change', model: r.model, calls, stopped, rounds: versions.slice(1).map((v, k) => ({ n: k, changes: v.changes, issues: v.issues, saw: v.saw })) })
      }
      onDrawn?.({ ids: new Set(touched), direction: r.ops.layout || null })
      setSug(s)
      setNote(t('Changed by {model}, as a suggestion: keep it or discard it, here or on the board.', { model: labelOf(m, r.model) }))
      setText('')
    } catch (e) { setErr(e.message); setRun((x) => (x && x.rounds.length ? { ...x, status: 'done', stop: 'error' } : null)) } finally { setBusy(false) }
  }

  // "Ask about these": a question about the shapes selected (with what's inside a container
  // selected), or the whole board, answered here, naming the shapes it's about; a model that can
  // see gets a picture of them. The board isn't changed.
  const ask = async () => {
    const { api: ex } = board
    const prompt = text.trim()
    if (!prompt) { setErr(t('Say what to ask')); return }
    setBusy(true); setErr(null); setNote(null); setAnswer(null)
    try {
      const all = ex.getSceneElements()
      const picked = new Set(Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, on]) => on).map(([id]) => id))
      for (const e of all) if (picked.has(e.id) && holderOf(e)) contents(e, all).forEach((c) => picked.add(c.id))
      const scope = picked.size ? picked : null
      const image = await sees(m.id) ? await picture(scope).catch(() => null) : null
      const r = await api('/boards/ask', { method: 'POST', body: { prompt, scene: describe(all, scope), selected: !!scope, image, model: m.id || undefined } })
      const d = describe(all)
      const named = new Map([...d.shapes, ...d.texts].map((x) => [x.id, x.text]))
      setAnswer({ text: r.answer, shapes: r.shapes.filter((id) => named.has(id)).map((id) => ({ id, label: named.get(id) || t('(no words)') })), model: r.model, saw: r.saw })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  // A shape the answer names, picked on the board and brought into view.
  const point = (id) => {
    const { api: ex } = board
    const el = ex.getSceneElements().filter((e) => e.id === id)
    if (!el.length) return
    ex.updateScene({ appState: { selectedElementIds: { [id]: true } } })
    ex.scrollToContent(el, { animate: true })
  }

  // A version picked: the board as it was after that round (⌘Z goes back).
  const show = (k) => {
    const { X, api: ex } = board
    const v = run?.rounds[k]
    if (!v || busy) return
    ex.updateScene({ elements: v.scene.map((e) => X.newElementWith(e, {})), captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
    drawnIds.current = new Set(v.scene.filter((e) => !e.isDeleted).map((e) => e.id))
    setRun((x) => ({ ...x, at: k }))
  }

  // The last Refine on this board, from another time: a version picked goes on the board beside
  // what's there (only a drawing's rounds have their diagram; a change's say what it did).
  useEffect(() => {
    if (!boardId || start) return
    api(`/boards/${encodeURIComponent(boardId)}/rounds`).then((r) => { if (r?.rounds?.length > 1) setPast({ ...r, pick: r.rounds.length - 1 }) }).catch(() => {})
  }, [boardId]) // eslint-disable-line react-hooks/exhaustive-deps
  const putBack = async () => {
    const spec = past?.rounds[past.pick]?.spec
    if (!spec || busy) return
    await fontsReady(look)
    const s = newSuggestion(past.model ? labelOf(m, past.model) : '')
    const ids = put(fromSpec(board.X, spec, drawOpts), null, s)
    drawnIds.current = ids
    setSug(s)
    onDrawn?.({ ids, direction: spec.direction || drawOpts.dir || 'LR' })
  }
  // The last suggestion (or all of them) kept or discarded from here, as from the board.
  const settle = (fn, all = false) => {
    const { X, api: ex } = board
    if ((!sug && !all) || !ex) return
    ex.updateScene({ elements: fn(X, ex.getSceneElementsIncludingDeleted(), all ? null : sug.id), captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
    setNote(fn === keepIt ? t('Kept.') : t('Discarded.'))
    setSug(null)
  }

  // Asked for before the board opened (from the list): drawn once the board is up.
  useEffect(() => {
    if (!start || ran.current || !board.api || !m.loaded) return
    ran.current = true
    onStarted?.()
    draw({ prompt: start.prompt, kind: start.kind, from: start.from, model: start.model, refine: start.refine })
  }, [board.api, m.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // The way AI Assist's menu asked for: Draw this, Change it or Ask; or a meeting move, made
  // straight away: Group by theme, or a timeline or the action items from what's on the board (with
  // nothing on it, from a meeting, picked here).
  useEffect(() => {
    const w = want?.mode
    if (!w || busy) return
    setMode(modeOf(w))
    if (w === 'themes') { themes(); return }
    if (w !== 'timeline' && w !== 'actions') return
    setKind(w)
    const all = board.api?.getSceneElements() || []
    if (all.length) { setFrom('board'); draw({ prompt: '', kind: w, from: { board: describe(all) } }) } else setFrom('meeting')
  }, [want?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (e) => { e?.preventDefault(); if (!busy) (mode === 'draw' ? draw() : mode === 'ask' ? ask() : change()) }
  const noModel = m.loaded && !m.models.length
  const cur = run?.rounds[run.at]
  const was = past?.rounds[past.pick]
  const asking = mode === 'ask'
  return (
    <form ref={form} className={`wb-draw${compact ? ' compact' : ''}`} onSubmit={go} aria-label={t('AI Assist')}>
      <AssistHead className="wb-draw-head" onClose={onClose}>
        <div className="seg small-seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'draw'} className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}><Icon name="shapes" size={12} /> {t('Draw this')}</button>
          <button type="button" role="tab" aria-selected={mode === 'change'} className={mode === 'change' ? 'on' : ''} onClick={() => setMode('change')} disabled={!scene.n}><Icon name="edit" size={12} /> {t('Change it')}</button>
          <button type="button" role="tab" aria-selected={asking} className={asking ? 'on' : ''} onClick={() => setMode('ask')} disabled={!scene.n} title={sel ? t('Ask about the {n} selected', { n: sel }) : t('Ask about the board')}><Icon name="chat" size={12} /> {t('Ask')}</button>
        </div>
      </AssistHead>
      <textarea ref={box} rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
        placeholder={mode === 'draw' ? t('A 3-tier web app on AWS, how a pull request gets merged, our office network, who reports to whom…') : asking ? (sel ? t('What to ask about the {n} selected: what\'s missing between these steps, what this part does…', { n: sel }) : t('What to ask about the board: what\'s missing, what a part does…')) : sel ? t('What to change in the {n} selected', { n: sel }) : t('What to change: rename a box, add a step, colour the risky parts red…')}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) go(e) }} aria-label={mode === 'draw' ? t('What to draw') : asking ? t('What to ask') : t('What to change')} />
      {mode === 'draw' && (
        <div className="wb-draw-opts">
          <div className="wb-kinds" role="radiogroup" aria-label={t('Kind of diagram')}>
            {KINDS.map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={kind === id} className={`chip${kind === id ? ' on' : ''}`} onClick={() => setKind(id)}>{t(label)}</button>)}
          </div>
          <label className="wb-from">
            <span className="muted small">{t('From')}</span>
            <select value={from} onChange={(e) => { setFrom(e.target.value); setFromId('') }} aria-label={t('Draw from')}>
              {FROM.filter(([id]) => id !== 'board' || scene.n).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
            {from && from !== 'board' && <select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label={t('Which one')} disabled={!choices?.length}>
              {!choices ? <option>{t('Loading…')}</option> : !choices.length ? <option>{t('None yet')}</option> : choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>}
          </label>
        </div>
      )}
      {mode === 'change' && <p className="muted small wb-scope">{sel ? t('Changes the {n} selected; the rest stays as it is.', { n: sel }) : t('Changes the whole board. Select shapes first to change only those.')}</p>}
      {mode === 'change' && (
        <div className="wb-moves">
          <button type="button" className="chip" onClick={themes} disabled={busy || noModel || !scene.n} title={sel ? t('The {n} selected, gathered in a box per theme', { n: sel }) : t('The notes on the board, gathered in a box per theme')}><Icon name="layers" size={11} /> {t('Group these notes by theme')}</button>
        </div>
      )}
      {asking && <p className="muted small wb-scope">{sel ? t('About the {n} selected. The board stays as it is.', { n: sel }) : t('About the whole board. Select shapes first to ask about only those.')}</p>}
      <div className="wb-draw-foot">
        {m.models.length > 1
          ? <select className="wb-model" value={m.id} onChange={(e) => m.pick(e.target.value)} aria-label={t('Model')}>{m.models.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          : m.model && <span className="muted small wb-model-one">{m.model.label}</span>}
        {!asking && (
          <label className="wb-refine" title={t('After drawing, the model looks over its own work and improves it, up to this many times.')}>
            <span className="muted small">{t('Refine')}</span>
            <select value={rounds} onChange={(e) => setRefine(Number(e.target.value))} aria-label={t('Rounds of refining')} disabled={busy}>
              {ROUNDS.map((n) => <option key={n} value={n}>{n ? `×${n}` : t('Off')}</option>)}
            </select>
          </label>
        )}
        <span className="wb-grow" />
        {busy && run && <button type="button" className="btn small" onClick={() => { stopRef.current = true }}>{t('Stop')}</button>}
        <button type="submit" className="btn small primary" disabled={busy || noModel || (!text.trim() && !(mode === 'draw' && from && (fromId || from === 'board')))}>
          <Icon name={busy ? 'refresh' : 'wand'} size={12} className={busy ? 'spin' : ''} /> {busy ? (mode === 'draw' ? t('Drawing…') : asking ? t('Asking…') : t('Changing…')) : mode === 'draw' ? t('Draw') : asking ? t('Ask') : t('Change')}
        </button>
      </div>
      {noModel
        ? <p className="small wb-privacy">{t('No model to draw with yet: sign in to an agent (Claude Code, Codex…) or add a key in Settings › Model Providers. You can still draw by hand.')} <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}>{t('Model Providers')}</button></p>
        : <p className="muted small wb-privacy">{asking ? goesAsk(m.model, sel) : goesTo(m.model, mode === 'draw' ? from : '', rounds > 0)}{!compact && dictKey ? ` ${t('Hold {key} to say it.', { key: dictKey })}` : ''}</p>}
      {asking && answer && (
        <div className="wb-answer" role="status" aria-label={t('The answer')}>
          <small className="muted wb-answer-by"><Icon name="wand" size={11} /> {answer.saw === 'picture' ? t('{model} answered, from the shapes and a picture of them', { model: labelOf(m, answer.model) }) : t('{model} answered, from the shapes', { model: labelOf(m, answer.model) })}</small>
          <p className="wb-answer-text">{answer.text}</p>
          {answer.shapes.length > 0 && (
            <div className="wb-answer-shapes" aria-label={t('The shapes it names')}>
              {answer.shapes.map((s) => <button type="button" key={s.id} className="chip" onClick={() => point(s.id)} title={t('Pick it on the board')}>{s.label}</button>)}
            </div>
          )}
          <div className="wb-sug-acts"><CopyButton text={answer.text} className="btn small" /><button type="button" className="ghost-btn" onClick={() => setAnswer(null)}>{t('Done')}</button></div>
        </div>
      )}
      {!asking && run && (run.rounds.length > 0 || run.status === 'running') && (
        <div className="wb-rounds" aria-label={t('Rounds')}>
          <div className="wb-rounds-head">
            <span className="small">
              {run.status === 'running'
                ? (run.step === 'draft' ? t('Drawing the first version…') : run.step === 'change' ? t('Making the change…') : run.step === 'look' ? t('Round {n} of {of}: looking at a picture of it…', { n: run.round, of: run.of }) : t('Round {n} of {of}: checking it…', { n: run.round, of: run.of }))
                : run.stop === 'clean' ? t('Done: the check found nothing more to fix.') : run.stop === 'fine' ? t('Done: {model} found nothing more to change.', { model: labelOf(m, run.model) }) : run.stop === 'you' ? t('Stopped.') : run.stop === 'error' ? t('Stopped by an error.') : t('Done: all {n} rounds.', { n: run.of })}
            </span>
            <span className="muted small wb-cost" role="status">{run.calls === 1 ? t('1 call') : t('{n} calls', { n: run.calls })}</span>
          </div>
          {run.status === 'running' && run.found && <p className="muted small wb-found">{t('Found: {what}', { what: run.found })}</p>}
          {run.rounds.length > 1 && (
            <div className="wb-versions" role="radiogroup" aria-label={t('Versions')}>
              {run.rounds.map((v, k) => <button type="button" key={k} role="radio" aria-checked={run.at === k} className={`chip${run.at === k ? ' on' : ''}`} onClick={() => show(k)} disabled={busy}>{v.label}</button>)}
            </div>
          )}
          {cur && run.at > 0 && (cur.changes.length > 0 || cur.found) && (
            <div className="wb-why small">
              {cur.found && <p className="muted">{cur.saw === 'picture' ? t('It looked at a picture of the board; the check found: {what}', { what: cur.found }) : t('The check found: {what}', { what: cur.found })}</p>}
              {cur.changes.length > 0 && <ul>{cur.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            </div>
          )}
        </div>
      )}
      {!asking && !run && was && (
        <div className="wb-rounds" aria-label={t('Last Refine')}>
          <div className="wb-rounds-head">
            <span className="small">{t('Last Refine, {when}', { when: fmtRelative(past.at) })}</span>
            <span className="muted small wb-cost">{past.calls === 1 ? t('1 call') : t('{n} calls', { n: past.calls })}</span>
          </div>
          <div className="wb-versions" role="radiogroup" aria-label={t('Versions')}>
            {past.rounds.map((v, k) => <button type="button" key={k} role="radio" aria-checked={past.pick === k} className={`chip${past.pick === k ? ' on' : ''}`} onClick={() => setPast((x) => ({ ...x, pick: k }))}>{k ? t('Round {n}', { n: k }) : past.mode === 'change' ? t('Change') : t('Draft')}</button>)}
          </div>
          {was.changes.length > 0 && <div className="wb-why small"><ul>{was.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
          {was.spec && <button type="button" className="btn small wb-put" onClick={putBack} disabled={busy}><Icon name="plus" size={12} /> {t('Put this version on the board')}</button>}
        </div>
      )}
      {err && <p className="error-text small" role="alert">{err}</p>}
      {note && <p className="muted small wb-note" role="status">{note}</p>}
      {actions && !busy && (
        <div className="wb-tasks">
          <span className="small">{actions.items.length === 1 ? t('1 action item') : t('{n} action items', { n: actions.items.length })}</span>
          {actions.added
            ? <span className="muted small" role="status"><Icon name="check" size={11} /> {t('On the Chief of Staff\'s task list')}</span>
            : <button type="button" className="btn small" onClick={toTasks} disabled={actions.busy} title={actions.items.join('\n')}><Icon name="check" size={12} /> {actions.busy ? t('Adding…') : t('Add them to Tasks')}</button>}
          {actions.error && <p className="error-text small" role="alert">{t("Couldn't add them all: {error}", { error: actions.error })}</p>}
        </div>
      )}
      {scene.sugs > 0 && !busy && (sug && scene.waits ? (
        <div className="wb-sug-acts">
          <button type="button" className="btn small primary" onClick={() => settle(keepIt)}><Icon name="check" size={12} /> {t('Keep')}</button>
          <button type="button" className="btn small" onClick={() => settle(discardIt)}>{t('Discard')}</button>
          {scene.sugs > 1 && <button type="button" className="btn small" onClick={() => settle(keepIt, true)}>{t('Keep all {n}', { n: scene.sugs })}</button>}
          <span className="muted small">{t('{undo} takes it back too.', { undo })}</span>
        </div>
      ) : (
        <div className="wb-sug-acts">
          <span className="muted small">{scene.sugs === 1 ? t('A suggestion waits on the board.') : t('{n} suggestions wait on the board.', { n: scene.sugs })}</span>
          <button type="button" className="btn small primary" onClick={() => settle(keepIt, true)}><Icon name="check" size={12} /> {scene.sugs === 1 ? t('Keep') : t('Keep all')}</button>
          <button type="button" className="btn small" onClick={() => settle(discardIt, true)}>{scene.sugs === 1 ? t('Discard') : t('Discard all')}</button>
        </div>
      ))}
    </form>
  )
}
const labelOf = (m, id) => m.models.find((x) => x.id === id)?.label || id
// A new suggestion's mark: which it is, and the model that made it, by name.
function newSuggestion(by) { return { id: `ai-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, by: by || '' } }
