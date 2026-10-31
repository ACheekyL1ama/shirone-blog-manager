import Editor from '@toast-ui/editor';
import '@toast-ui/editor/dist/i18n/zh-cn';
import DOMPurify from 'dompurify';
// Permit our read-only local media protocol while keeping scripts and event handlers out.
function sanitize(html, options = {}) {
  return DOMPurify.sanitize(html, {
    ...options,
    ADD_ATTR: ['rel', 'target', 'hreflang', 'type'],
    FORBID_TAGS: ['input','script','textarea','form','button','select','meta','style','link','title','object','base','iframe','embed'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blog-asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
window.toastui = { Editor, sanitize };
