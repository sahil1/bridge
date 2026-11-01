// Excalidraw (MIT), loaded the first time a whiteboard is drawn, so it never slows the app's start:
// its code, its styles and, only when a diagram is turned from Mermaid, Mermaid itself are their own
// files in the build. Its fonts come from Bridge AI (scripts/whiteboard-assets.js), set here before
// the library first runs.
let loading = null
export function loadExcalidraw() {
  if (!loading) {
    window.EXCALIDRAW_ASSET_PATH = new URL('assets/excalidraw/', document.baseURI).href
    loading = Promise.all([import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')]).then(([X]) => X)
    loading.catch(() => { loading = null })
  }
  return loading
}

let mermaid = null
export const loadMermaid = () => (mermaid ||= import('@excalidraw/mermaid-to-excalidraw').catch((e) => { mermaid = null; throw e }))
