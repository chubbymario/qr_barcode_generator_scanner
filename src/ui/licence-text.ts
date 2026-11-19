// Licence files are hard-wrapped at about 80 characters. Shown as-is they
// leave a wide dialog half empty (or run off a phone screen), so rejoin the
// lines of each paragraph and let the browser wrap them. Indented blocks
// (lists, code) keep their line breaks; separator lines become rules.

import { h } from './dom';

export function licenceBlocks(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const block of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push(h('p', {}, para.join(' ')));
      para = [];
    };
    for (const line of lines) {
      if (/^\s*[-=_*]{5,}\s*$/.test(line)) {
        flush();
        out.push(h('hr'));
      } else if (/^\s{2,}|^\s*(\d+\.|[a-z]\)|\(\w\)|[-*•])\s/.test(line)) {
        // Indented or a list item: its own line.
        flush();
        out.push(h('p', { class: 'indent' }, line.trim()));
      } else {
        // Only lines that were wrapped to fit (long ones) continue onto the
        // next; a short line ("License: MIT") ended on purpose.
        const prev = para[para.length - 1];
        if (prev !== undefined && prev.length < 55) flush();
        para.push(line.trim());
      }
    }
    flush();
  }
  return out;
}
