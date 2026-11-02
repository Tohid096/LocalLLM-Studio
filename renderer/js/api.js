// Shared helpers for renderer modules
// v2.2.0: full markdown renderer (headings, lists, quotes, tables),
//         offline highlight.js code highlighting + per-block Copy button.

function el(id) { return document.getElementById(id); }
function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function fmtSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(msg, type = '') {
  const t = h('div', 'toast ' + type, esc(msg));
  el('toast-wrap').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 5200);
}

// rough token estimate (~3.6 chars per token for English/code mix)
function estTokens(s) { return Math.ceil(String(s || '').length / 3.6); }

// clipboard with fallback (works inside Electron with contextIsolation)
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
  }
  return Promise.resolve(legacyCopy(t));
}
function legacyCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
}

// ---------- code block rendering (highlight.js + copy button) ----------
const HL_ALIAS = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', 'c++': 'cpp', 'c#': 'csharp', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', htm: 'xml', html: 'xml' };
function renderCodeBlock(info, code, live) {
  const orig = String(info || '').trim().split(/[\s:+,.]/)[0].toLowerCase();
  const lang = HL_ALIAS[orig] || orig;
  let codeHtml = esc(code);
  if (!live && window.hljs) {
    try {
      if (lang && window.hljs.getLanguage(lang)) codeHtml = window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      else codeHtml = window.hljs.highlightAuto(code).value;
    } catch (e) { codeHtml = esc(code); }
  }
  return '<div class="code-block"><div class="code-head"><span class="code-lang">' + esc(orig || 'text') + '</span>' +
    '<button class="code-copy" type="button" title="Copy code">⧉ Copy</button></div>' +
    '<pre><code class="hljs">' + codeHtml + '</code></pre></div>';
}

// ---------- markdown ----------
function mdToHtml(text, opts = {}) {
  const live = !!opts.live;
  const s0 = String(text == null ? '' : text);
  // pull fenced code blocks out first so nothing inside them is mangled
  const blocks = [];
  const s = s0.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (_m, info, code) => {
    blocks.push({ info: String(info || ''), code: String(code).replace(/\n$/, '') });
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });

  const lines = esc(s).split('\n');
  let html = '';
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + para.join('<br>') + '</p>'; para = []; } };
  const flushList = () => { if (list) { html += '</' + list + '>'; list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cb = line.match(/^\u0000B(\d+)\u0000$/);
    if (cb) { flushPara(); flushList(); html += renderCodeBlock(blocks[+cb[1]].info, blocks[+cb[1]].code, live); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    // table row group: | a | b |
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara(); flushList();
      const rows = [];
      let j = i;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(lines[j]); j++; }
      i = j - 1;
      const cells = rows.map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inlineMd(c.trim())));
      const isSep = (k) => cells[k].length > 0 && cells[k].every(c => /^:?-+:?$/.test(c.replace(/&amp;/g, '&').trim() || '--'));
      let tbl = '<table>';
      cells.forEach((row, k) => {
        if (isSep(k)) return;
        const tag = (k === 0 && rows.length > 1 && isSep(1)) ? 'th' : 'td';
        tbl += '<tr>' + row.map(c => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>';
      });
      tbl += '</table>';
      html += tbl;
      continue;
    }

    const hd = line.match(/^(#{1,6})\s+(.*)$/);
    if (hd) { flushPara(); flushList(); const l = Math.min(6, hd[1].length + 2); html += '<h' + l + ' class="md-h">' + hd[2] + '</h' + l + '>'; continue; }
    if (/^(\s*)(---+|\*\*\*+|___+)\s*$/.test(line)) { flushPara(); flushList(); html += '<hr>'; continue; }
    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) { flushPara(); flushList(); html += '<blockquote>' + inlineMd(bq[1]) + '</blockquote>'; continue; }
    const ul = line.match(/^\s*[-*•+]\s+(.*)$/);
    if (ul) { flushPara(); if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; } html += '<li>' + inlineMd(ul[1]) + '</li>'; continue; }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { flushPara(); if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; } html += '<li>' + inlineMd(ol[1]) + '</li>'; continue; }
    flushList();          // a plain line ends any open list before becoming a paragraph
    para.push(inlineMd(line));
  }
  flushPara(); flushList();
  return html;
}

function inlineMd(s) {
  return String(s)
    .replace(/`([^`\n]+)`/g, '<code class="ic">$1</code>')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?;:])/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?;:])/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
}

// one delegated listener: copy buttons on every code block (chat, agent, anywhere)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.code-copy');
  if (!btn) return;
  const block = btn.closest('.code-block');
  const code = block ? block.querySelector('pre code, pre') : null;
  if (!code) return;
  copyText(code.textContent || '').then(() => {
    const old = btn.textContent;
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1400);
  });
});

window.el = el; window.h = h; window.fmtSize = fmtSize; window.esc = esc; window.toast = toast;
window.mdToHtml = mdToHtml; window.estTokens = estTokens; window.copyText = copyText;
