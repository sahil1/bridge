import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { usePersisted } from '../layout.jsx'
import { api, usePoll } from '../../api.js'
import { t, tx } from '../../i18n/index.js'
import { defaultKey, keyLabel } from '../../../shared/dictation/keys.js'
import { fromMermaid, placeBeside, describe, applyOps } from './convert.js'

// "Draw this" and "Change it": words (typed, or said with the dictation key) to a model, and back
// as shapes on the board, which ⌘Z takes back. Drawing can also start from a meeting, a project or
// an agent's work. The model is yours (models()): what it's sent is said under the button.
export const KINDS = [['auto', tx('Any kind')], ['flowchart', tx('Flowchart')], ['architecture', tx('Architecture')], ['sequence', tx('Sequence')], ['org', tx('Org chart')], ['mindmap', tx('Mind map')]]
const FROM = [['', tx('Just my words')], ['meeting', tx('A meeting')], ['project', tx('A project')], ['agent', tx("An agent's work")]]

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
    if (!from) return
    const get = from === 'meeting' ? api('/meetings').then((r) => (r.meetings || []).filter((m) => !m.archived).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 40).map((m) => ({ id: m.id, label: `${m.title} · ${new Date(m.startedAt).toLocaleDateString()}` })))
      : from === 'project' ? api('/projects').then((r) => (r.projects || []).map((p) => ({ id: p.path, label: p.name })))
        : api('/fleet').then((f) => (f.agents || []).filter((a) => !a.chief && !a.cloud && !a.shellTab).map((a) => ({ id: a.paneId, label: `${a.title || a.kind}${a.workspace ? ` · ${a.workspace}` : ''}` })))
    get.then(setItems).catch(() => setItems([]))
  }, [from])
  return items
}

// Where the words go, said plainly before anything is sent.
function goesTo(model, from) {
  if (!model) return ''
  const what = from === 'meeting' ? t('Your words and the meeting') : from === 'project' ? t("Your words and the project's file names and README") : from === 'agent' ? t("Your words and the agent's conversation") : t('Your words')
  return model.via === 'local' ? t('{what} stay on this computer ({model}).', { what, model: model.label }) : t('{what} go to {model} ({provider}). Nothing else leaves this computer.', { what, model: model.label, provider: model.provider || model.label })
}

// board: { X, api } of the drawing on screen. start: a drawing asked for before the board opened
// ({ prompt, kind, from, model }), drawn straight away.
export default function DrawPanel({ board, start, onClose, compact = false }) {
  const els = board.api?.getSceneElements() || []
  const [mode, setMode] = useState(start ? 'draw' : els.length ? 'change' : 'draw')
  const [text, setText] = useState(start?.prompt || '')
  const [kind, setKind] = usePersisted('cc-board-kind', 'auto')
  const [from, setFrom] = useState(start?.from ? Object.keys(start.from)[0] : '')
  const [fromId, setFromId] = useState(start?.from ? Object.values(start.from)[0] : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [note, setNote] = useState(null)
  const m = useBoardModels()
  const choices = useChoices(mode === 'draw' ? from : '')
  const box = useRef(null)
  const ran = useRef(false)
  // How much is on the board and how much is selected, kept up as you draw.
  const count = (elements, appState) => ({ n: elements.filter((e) => !e.isDeleted).length, sel: Object.values(appState?.selectedElementIds || {}).filter(Boolean).length })
  const [scene, setScene] = useState(() => count(els, board.api?.getAppState()))
  useEffect(() => board.api?.onChange((elements, appState) => { const c = count(elements, appState); setScene((x) => (x.n === c.n && x.sel === c.sel ? x : c)) }), [board.api])
  const sel = scene.sel
  // Dictation's key (Settings › Voice), to say what to draw.
  const dict = usePoll('/config', 10 * 60 * 1000).data?.dictation
  const platform = window.bridgeApp?.platform || (/Mac|iPhone|iPad/.test(navigator.platform) ? 'darwin' : /Win/.test(navigator.platform) ? 'win32' : 'linux')
  const dictKey = dict?.on === false ? null : keyLabel(dict?.key || defaultKey(platform), platform)
  const undo = platform === 'darwin' ? '⌘Z' : 'Ctrl+Z'

  useEffect(() => { box.current?.focus() }, [mode])
  useEffect(() => { if (from && choices?.length && !choices.some((c) => c.id === fromId)) setFromId(choices[0].id) }, [choices]) // eslint-disable-line react-hooks/exhaustive-deps

  const draw = async (o = {}) => {
    const { X, api: ex } = board
    const prompt = (o.prompt ?? text).trim()
    const src = o.from || (from && fromId ? { [from]: fromId } : null)
    if (!prompt && !src) { setErr(t('Say what to draw')); return }
    setBusy(true); setErr(null); setNote(null)
    try {
      const body = { prompt, kind: o.kind || kind, from: src, model: o.model || m.id || undefined }
      let r = await api('/boards/draw', { method: 'POST', body })
      let got
      // Mermaid that doesn't draw goes back to the model once, with why.
      try { got = await fromMermaid(X, r.mermaid) } catch (e) {
        r = await api('/boards/draw', { method: 'POST', body: { ...body, again: { mermaid: r.mermaid, error: e.message } } })
        got = await fromMermaid(X, r.mermaid)
      }
      if (!got.elements.length) throw new Error(t('The model sent back an empty diagram. Try again, or say it another way.'))
      const { width, height, scrollX, scrollY, zoom } = ex.getAppState()
      const view = { x: -scrollX + width / 2 / zoom.value, y: -scrollY + height / 2 / zoom.value }
      const placed = placeBeside(X, got.elements, ex.getSceneElements(), view)
      if (Object.keys(got.files).length) ex.addFiles(Object.values(got.files))
      ex.updateScene({
        elements: [...ex.getSceneElementsIncludingDeleted(), ...placed],
        appState: { selectedElementIds: Object.fromEntries(placed.filter((e) => !e.containerId).map((e) => [e.id, true])) },
        captureUpdate: X.CaptureUpdateAction.IMMEDIATELY,
      })
      ex.scrollToContent(placed, { fitToViewport: true, viewportZoomFactor: 0.85, animate: true })
      setNote(t('Drawn by {model}. {undo} takes it back.', { model: labelOf(m, r.model), undo }))
      setText('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const change = async () => {
    const { X, api: ex } = board
    const prompt = text.trim()
    if (!prompt) { setErr(t('Say what to change')); return }
    setBusy(true); setErr(null); setNote(null)
    try {
      const picked = new Set(Object.entries(ex.getAppState().selectedElementIds || {}).filter(([, on]) => on).map(([id]) => id))
      const scene = describe(ex.getSceneElements(), picked.size ? picked : null)
      const r = await api('/boards/change', { method: 'POST', body: { prompt, scene, selected: picked.size > 0, model: m.id || undefined } })
      const { elements, touched } = applyOps(X, ex.getSceneElementsIncludingDeleted(), r.ops)
      const n = r.ops.update.length + r.ops.add.length + r.ops.connect.length + r.ops.remove.length
      if (!n) { setNote(t('{model} found nothing to change.', { model: labelOf(m, r.model) })); return }
      ex.updateScene({ elements, appState: { selectedElementIds: Object.fromEntries(touched.map((id) => [id, true])) }, captureUpdate: X.CaptureUpdateAction.IMMEDIATELY })
      setNote(t('Changed by {model}. {undo} takes it back.', { model: labelOf(m, r.model), undo }))
      setText('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  // Asked for before the board opened (from the list): drawn once the board is up.
  useEffect(() => {
    if (!start || ran.current || !board.api || !m.loaded) return
    ran.current = true
    draw({ prompt: start.prompt, kind: start.kind, from: start.from, model: start.model })
  }, [board.api, m.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (e) => { e?.preventDefault(); if (!busy) (mode === 'draw' ? draw() : change()) }
  const noModel = m.loaded && !m.models.length
  return (
    <form className={`wb-draw${compact ? ' compact' : ''}`} onSubmit={go} aria-label={t('Draw with a model')}>
      <div className="wb-draw-head">
        <div className="seg small-seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'draw'} className={mode === 'draw' ? 'on' : ''} onClick={() => setMode('draw')}><Icon name="sparkle" size={12} /> {t('Draw this')}</button>
          <button type="button" role="tab" aria-selected={mode === 'change'} className={mode === 'change' ? 'on' : ''} onClick={() => setMode('change')} disabled={!scene.n}><Icon name="edit" size={12} /> {t('Change it')}</button>
        </div>
        {onClose && <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>}
      </div>
      <textarea ref={box} rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
        placeholder={mode === 'draw' ? t('A flowchart of how a pull request gets merged, the parts of our app, who reports to whom…') : sel ? t('What to change in the {n} selected', { n: sel }) : t('What to change: rename a box, add a step, colour the risky parts red…')}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) go(e) }} aria-label={mode === 'draw' ? t('What to draw') : t('What to change')} />
      {mode === 'draw' && (
        <div className="wb-draw-opts">
          <div className="wb-kinds" role="radiogroup" aria-label={t('Kind of diagram')}>
            {KINDS.map(([id, label]) => <button type="button" key={id} role="radio" aria-checked={kind === id} className={`chip${kind === id ? ' on' : ''}`} onClick={() => setKind(id)}>{t(label)}</button>)}
          </div>
          <label className="wb-from">
            <span className="muted small">{t('From')}</span>
            <select value={from} onChange={(e) => { setFrom(e.target.value); setFromId('') }} aria-label={t('Draw from')}>
              {FROM.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
            {from && <select value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label={t('Which one')} disabled={!choices?.length}>
              {!choices ? <option>{t('Loading…')}</option> : !choices.length ? <option>{t('None yet')}</option> : choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>}
          </label>
        </div>
      )}
      {mode === 'change' && <p className="muted small wb-scope">{sel ? t('Changes the {n} selected; the rest stays as it is.', { n: sel }) : t('Changes the whole board. Select shapes first to change only those.')}</p>}
      <div className="wb-draw-foot">
        {m.models.length > 1
          ? <select className="wb-model" value={m.id} onChange={(e) => m.pick(e.target.value)} aria-label={t('Model')}>{m.models.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          : m.model && <span className="muted small wb-model-one">{m.model.label}</span>}
        <span className="wb-grow" />
        <button type="submit" className="btn small primary" disabled={busy || noModel || (!text.trim() && !(mode === 'draw' && from && fromId))}>
          <Icon name={busy ? 'refresh' : 'sparkle'} size={12} className={busy ? 'spin' : ''} /> {busy ? (mode === 'draw' ? t('Drawing…') : t('Changing…')) : mode === 'draw' ? t('Draw') : t('Change')}
        </button>
      </div>
      {noModel
        ? <p className="small wb-privacy">{t('No model to draw with yet: sign in to an agent (Claude Code, Codex…) or add a key in Settings › Model Providers. You can still draw by hand.')} <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}>{t('Model Providers')}</button></p>
        : <p className="muted small wb-privacy">{goesTo(m.model, mode === 'draw' ? from : '')}{!compact && dictKey ? ` ${t('Hold {key} to say it.', { key: dictKey })}` : ''}</p>}
      {err && <p className="error-text small" role="alert">{err}</p>}
      {note && <p className="muted small wb-note" role="status">{note}</p>}
    </form>
  )
}
const labelOf = (m, id) => m.models.find((x) => x.id === id)?.label || id
