import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Markdown from outside the app (a repo's README, a model's answer or summary of a meeting) as HTML,
// cleaned: no script, no styles, forms or buttons that could dress up as the app or ask for a key,
// and links only to the web, mail or a place in the page or repo. Web and mail links open outside
// the app.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^(https?:|mailto:)/i.test(node.getAttribute('href') || '')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer')
  }
})
const CLEAN = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
  FORBID_ATTR: ['style'],
  // DOMPurify's own, less ftp:, tel:, sms: and other apps' links: web, mail, or relative.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
}

export const clean = (html) => DOMPurify.sanitize(html, CLEAN)
export const markdownHtml = (s) => clean(marked.parse(String(s || ''), { gfm: true, breaks: false }))
