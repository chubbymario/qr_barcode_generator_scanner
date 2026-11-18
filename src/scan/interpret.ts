// Work out what scanned text means (website, Wi-Fi, contact, ...) so the
// scanner can show it sensibly and send it back to the QR generator.
// This is the inverse of src/qr/content.ts.

import type { ContentType, Fields } from '../qr/content';

export interface Interpreted {
  type: ContentType;
  fields: Fields;
  summary: [string, string][]; // label, value
  /** A link that is safe to open: only these schemes. */
  href?: string;
}

const SAFE_SCHEMES = /^(https?:|mailto:|tel:|sms:|smsto:|geo:)/i;

function unescapeWifi(v: string): string {
  return v.replace(/\\(.)/g, '$1');
}

/** Split "A:1;B:2;" on unescaped semicolons. */
function splitWifi(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      cur += c + body[++i];
    } else if (c === ';') {
      const m = /^([A-Z]+):([\s\S]*)$/.exec(cur);
      if (m) out[m[1]] = unescapeWifi(m[2]);
      cur = '';
    } else cur += c;
  }
  return out;
}

function unescapeV(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Lines of a vCard/iCalendar, with folded lines joined. */
function vLines(text: string): [string, string][] {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .map((l) => {
      const i = l.indexOf(':');
      return i === -1 ? null : ([l.slice(0, i).toUpperCase(), l.slice(i + 1)] as [string, string]);
    })
    .filter((x): x is [string, string] => !!x);
}

function fromICal(v: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(v);
  if (!m) return '';
  return m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}T00:00`;
}

export function interpret(text: string): Interpreted {
  const t = text.trim();

  if (/^WIFI:/i.test(t)) {
    const f = splitWifi(t.slice(5));
    const security = f.T || 'nopass';
    const fields: Fields = {
      ssid: f.S ?? '',
      security: ['WPA', 'SAE', 'WEP', 'nopass'].includes(security) ? security : 'WPA',
      password: f.P ?? '',
      hidden: f.H === 'true',
    };
    const summary: [string, string][] = [['Network', String(fields.ssid)]];
    if (fields.security !== 'nopass') summary.push(['Password', String(fields.password)]);
    summary.push([
      'Security',
      security === 'SAE' ? 'WPA3' : security === 'nopass' ? 'None' : security,
    ]);
    return { type: 'wifi', fields, summary };
  }

  if (/^BEGIN:VCARD/i.test(t)) {
    const fields: Fields = {};
    for (const [key, value] of vLines(t)) {
      const name = key.split(';')[0];
      const v = unescapeV(value);
      if (name === 'N') {
        const [last = '', first = ''] = value.split(';').map(unescapeV);
        fields.lastName = last;
        fields.firstName = first;
      } else if (name === 'ORG') fields.org = v;
      else if (name === 'TITLE') fields.title = v;
      else if (name === 'TEL') {
        if (/WORK/.test(key) && !fields.workPhone) fields.workPhone = v;
        else if (!fields.mobile) fields.mobile = v;
      } else if (name === 'EMAIL' && !fields.email) fields.email = v;
      else if (name === 'URL' && !fields.website) fields.website = v;
      else if (name === 'ADR') {
        const p = value.split(';').map(unescapeV);
        [fields.street, fields.city, fields.region, fields.postcode, fields.country] = [
          p[2],
          p[3],
          p[4],
          p[5],
          p[6],
        ].map((x) => x ?? '');
      } else if (name === 'NOTE') fields.note = v;
      else if (name === 'FN' && !fields.firstName && !fields.lastName) fields.firstName = v;
    }
    const name = [fields.firstName, fields.lastName].filter(Boolean).join(' ');
    const summary: [string, string][] = [];
    if (name) summary.push(['Name', name]);
    for (const [k, label] of [
      ['org', 'Company'],
      ['mobile', 'Phone'],
      ['email', 'Email'],
      ['website', 'Website'],
    ]) {
      if (fields[k]) summary.push([label, String(fields[k])]);
    }
    return { type: 'vcard', fields, summary };
  }

  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(t)) {
    const fields: Fields = { allDay: false };
    for (const [key, value] of vLines(t)) {
      const name = key.split(';')[0];
      if (name === 'SUMMARY') fields.title = unescapeV(value);
      else if (name === 'DTSTART') {
        fields.start = fromICal(value);
        if (/VALUE=DATE/.test(key) || /^\d{8}$/.test(value)) fields.allDay = true;
      } else if (name === 'DTEND') fields.end = fromICal(value);
      else if (name === 'LOCATION') fields.location = unescapeV(value);
      else if (name === 'DESCRIPTION') fields.description = unescapeV(value);
    }
    const summary: [string, string][] = [['Event', String(fields.title ?? '')]];
    if (fields.start) summary.push(['Starts', String(fields.start).replace('T', ' ')]);
    if (fields.location) summary.push(['Where', String(fields.location)]);
    return { type: 'event', fields, summary };
  }

  if (/^mailto:/i.test(t)) {
    const [addr, query = ''] = t.slice(7).split('?');
    const q = new URLSearchParams(query);
    const fields: Fields = {
      to: decodeURIComponent(addr),
      cc: q.get('cc') ?? '',
      subject: q.get('subject') ?? '',
      body: q.get('body') ?? '',
    };
    return {
      type: 'email',
      fields,
      summary: [
        ['To', String(fields.to)],
        ['Subject', String(fields.subject)],
      ].filter(([, v]) => v) as [string, string][],
      href: t,
    };
  }

  if (/^smsto:/i.test(t)) {
    const rest = t.slice(6);
    const i = rest.indexOf(':');
    const number = i === -1 ? rest : rest.slice(0, i);
    const message = i === -1 ? '' : rest.slice(i + 1);
    return {
      type: 'sms',
      fields: { number, message, format: 'smsto' },
      summary: [
        ['To', number],
        ['Message', message],
      ].filter(([, v]) => v) as [string, string][],
      href: `sms:${number}${message ? `?body=${encodeURIComponent(message)}` : ''}`,
    };
  }
  if (/^sms:/i.test(t)) {
    const [number, query = ''] = t.slice(4).split('?');
    const message = new URLSearchParams(query).get('body') ?? '';
    return {
      type: 'sms',
      fields: { number, message, format: 'uri' },
      summary: [['To', number]],
      href: t,
    };
  }

  if (/^tel:/i.test(t)) {
    const number = t.slice(4);
    return { type: 'phone', fields: { number }, summary: [['Number', number]], href: t };
  }

  if (/^geo:/i.test(t)) {
    const m = /^geo:([-\d.]+),([-\d.]+)(?:\?q=([^]*))?/i.exec(t);
    const lat = m?.[1] ?? '';
    const lng = m?.[2] ?? '';
    const label = m?.[3] ? decodeURIComponent(m[3]).replace(/^[-\d.,]+\((.*)\)$/, '$1') : '';
    return {
      type: 'geo',
      fields: { lat, lng, label, format: 'geo' },
      summary: [['Location', `${lat}, ${lng}${label ? ` (${label})` : ''}`]],
      href: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=16/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`,
    };
  }

  const wa = /^https:\/\/wa\.me\/(\d+)(?:\?text=(.*))?$/i.exec(t);
  if (wa) {
    const message = wa[2] ? decodeURIComponent(wa[2]) : '';
    return {
      type: 'whatsapp',
      fields: { number: wa[1], message },
      summary: [['WhatsApp', `+${wa[1]}`]],
      href: t,
    };
  }

  if (/^https?:\/\/\S+$/i.test(t)) {
    let host = '';
    try {
      host = new URL(t).host;
    } catch {
      /* not a valid URL */
    }
    return {
      type: 'url',
      fields: { url: t },
      summary: host ? [['Website', host]] : [],
      href: host ? t : undefined,
    };
  }

  return { type: 'text', fields: { text }, summary: [] };
}

export function safeHref(href: string | undefined): string | undefined {
  return href && SAFE_SCHEMES.test(href) ? href : undefined;
}
