// Builders that turn form fields into the text a QR code carries.
// These follow the de-facto formats phone cameras understand (ZXing / iOS / Android).

export type ContentType =
  'url' | 'text' | 'wifi' | 'vcard' | 'email' | 'sms' | 'phone' | 'whatsapp' | 'geo' | 'event';

export type Fields = Record<string, string | boolean>;

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'checkbox' | 'datetime-local' | 'tel' | 'email' | 'url';
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Hide this field unless the predicate returns true. */
  when?: (f: Fields) => boolean;
  autocomplete?: string;
}

export interface ContentDef {
  type: ContentType;
  label: string;
  fields: FieldDef[];
  defaults: Fields;
  build: (f: Fields) => string;
}

const s = (f: Fields, k: string): string => {
  const v = f[k];
  return typeof v === 'string' ? v : '';
};
const b = (f: Fields, k: string): boolean => f[k] === true;

/** Escape for WIFI: and MECARD-style payloads. */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/** Escape for vCard 3.0 / iCalendar text values. */
export function escapeVText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildWifi(f: Fields): string {
  const security = s(f, 'security') || 'WPA';
  const parts = [`T:${security}`, `S:${escapeWifi(s(f, 'ssid'))}`];
  if (security !== 'nopass') parts.push(`P:${escapeWifi(s(f, 'password'))}`);
  if (b(f, 'hidden')) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

export function buildVCard(f: Fields): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const first = s(f, 'firstName');
  const last = s(f, 'lastName');
  lines.push(`N:${escapeVText(last)};${escapeVText(first)};;;`);
  const full = [first, last].filter(Boolean).join(' ') || s(f, 'org');
  lines.push(`FN:${escapeVText(full)}`);
  if (s(f, 'org')) lines.push(`ORG:${escapeVText(s(f, 'org'))}`);
  if (s(f, 'title')) lines.push(`TITLE:${escapeVText(s(f, 'title'))}`);
  if (s(f, 'mobile')) lines.push(`TEL;TYPE=CELL:${s(f, 'mobile')}`);
  if (s(f, 'workPhone')) lines.push(`TEL;TYPE=WORK,VOICE:${s(f, 'workPhone')}`);
  if (s(f, 'email')) lines.push(`EMAIL;TYPE=INTERNET:${s(f, 'email')}`);
  if (s(f, 'website')) lines.push(`URL:${s(f, 'website')}`);
  const adr = ['street', 'city', 'region', 'postcode', 'country'].map((k) => escapeVText(s(f, k)));
  if (adr.some(Boolean)) lines.push(`ADR;TYPE=WORK:;;${adr.join(';')}`);
  if (s(f, 'note')) lines.push(`NOTE:${escapeVText(s(f, 'note'))}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function buildEmail(f: Fields): string {
  const params = new URLSearchParams();
  if (s(f, 'cc')) params.set('cc', s(f, 'cc'));
  if (s(f, 'subject')) params.set('subject', s(f, 'subject'));
  if (s(f, 'body')) params.set('body', s(f, 'body'));
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  const query = params.toString().replace(/\+/g, '%20');
  return `mailto:${s(f, 'to')}${query ? `?${query}` : ''}`;
}

export function buildSms(f: Fields): string {
  const number = s(f, 'number').replace(/[^\d+]/g, '');
  const message = s(f, 'message');
  if (s(f, 'format') === 'uri') {
    return `sms:${number}${message ? `?body=${encodeURIComponent(message)}` : ''}`;
  }
  return `SMSTO:${number}:${message}`;
}

export function buildPhone(f: Fields): string {
  return `tel:${s(f, 'number').replace(/[^\d+*#]/g, '')}`;
}

export function buildWhatsApp(f: Fields): string {
  const number = s(f, 'number').replace(/\D/g, '');
  const message = s(f, 'message');
  return `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export function buildGeo(f: Fields): string {
  const lat = s(f, 'lat').trim();
  const lng = s(f, 'lng').trim();
  const label = s(f, 'label');
  if (s(f, 'format') === 'maps') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  return `geo:${lat},${lng}${label ? `?q=${encodeURIComponent(`${lat},${lng}(${label})`)}` : ''}`;
}

/** "2026-11-18T09:30" -> "20261118T093000" (floating local time). */
export function toICalDate(value: string, allDay: boolean): string {
  const digits = value.replace(/[-:]/g, '');
  if (allDay) return digits.slice(0, 8);
  const [date, time = '0000'] = digits.split('T');
  return `${date}T${time.padEnd(6, '0').slice(0, 6)}`;
}

export function buildEvent(f: Fields): string {
  const allDay = b(f, 'allDay');
  const lines = ['BEGIN:VEVENT', `SUMMARY:${escapeVText(s(f, 'title'))}`];
  const start = s(f, 'start');
  const end = s(f, 'end');
  const prefix = allDay ? ';VALUE=DATE' : '';
  if (start) lines.push(`DTSTART${prefix}:${toICalDate(start, allDay)}`);
  if (end) lines.push(`DTEND${prefix}:${toICalDate(end, allDay)}`);
  if (s(f, 'location')) lines.push(`LOCATION:${escapeVText(s(f, 'location'))}`);
  if (s(f, 'description')) lines.push(`DESCRIPTION:${escapeVText(s(f, 'description'))}`);
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

export const CONTENT_TYPES: ContentDef[] = [
  {
    type: 'url',
    label: 'Website',
    fields: [{ key: 'url', label: 'Address', kind: 'url', placeholder: 'https://example.com' }],
    defaults: { url: 'https://example.com' },
    build: (f) => {
      const url = s(f, 'url').trim();
      if (!url) return '';
      return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
    },
  },
  {
    type: 'text',
    label: 'Text',
    fields: [{ key: 'text', label: 'Text', kind: 'textarea', placeholder: 'Anything you like' }],
    defaults: { text: 'Hello!' },
    build: (f) => s(f, 'text'),
  },
  {
    type: 'wifi',
    label: 'Wi-Fi',
    fields: [
      { key: 'ssid', label: 'Network name', kind: 'text', autocomplete: 'off' },
      {
        key: 'security',
        label: 'Security',
        kind: 'select',
        options: [
          { value: 'WPA', label: 'WPA / WPA2' },
          { value: 'SAE', label: 'WPA3' },
          { value: 'WEP', label: 'WEP' },
          { value: 'nopass', label: 'None' },
        ],
      },
      {
        key: 'password',
        label: 'Password',
        kind: 'text',
        autocomplete: 'off',
        when: (f) => f.security !== 'nopass',
      },
      { key: 'hidden', label: 'Hidden network', kind: 'checkbox' },
    ],
    defaults: { ssid: 'Home', security: 'WPA', password: '', hidden: false },
    build: buildWifi,
  },
  {
    type: 'vcard',
    label: 'Contact',
    fields: [
      { key: 'firstName', label: 'First name', kind: 'text', autocomplete: 'given-name' },
      { key: 'lastName', label: 'Last name', kind: 'text', autocomplete: 'family-name' },
      { key: 'org', label: 'Company', kind: 'text', autocomplete: 'organization' },
      { key: 'title', label: 'Job title', kind: 'text', autocomplete: 'organization-title' },
      { key: 'mobile', label: 'Mobile', kind: 'tel', autocomplete: 'tel' },
      { key: 'workPhone', label: 'Work phone', kind: 'tel' },
      { key: 'email', label: 'Email', kind: 'email', autocomplete: 'email' },
      { key: 'website', label: 'Website', kind: 'url', autocomplete: 'url' },
      { key: 'street', label: 'Street', kind: 'text', autocomplete: 'street-address' },
      { key: 'city', label: 'City', kind: 'text', autocomplete: 'address-level2' },
      { key: 'region', label: 'State / region', kind: 'text', autocomplete: 'address-level1' },
      { key: 'postcode', label: 'Postcode', kind: 'text', autocomplete: 'postal-code' },
      { key: 'country', label: 'Country', kind: 'text', autocomplete: 'country-name' },
      { key: 'note', label: 'Note', kind: 'textarea' },
    ],
    defaults: { firstName: 'Alex', lastName: 'Tan' },
    build: buildVCard,
  },
  {
    type: 'email',
    label: 'Email',
    fields: [
      { key: 'to', label: 'To', kind: 'email' },
      { key: 'cc', label: 'Cc', kind: 'email' },
      { key: 'subject', label: 'Subject', kind: 'text' },
      { key: 'body', label: 'Message', kind: 'textarea' },
    ],
    defaults: { to: 'hello@example.com' },
    build: buildEmail,
  },
  {
    type: 'sms',
    label: 'SMS',
    fields: [
      { key: 'number', label: 'Phone number', kind: 'tel' },
      { key: 'message', label: 'Message', kind: 'textarea' },
      {
        key: 'format',
        label: 'Format',
        kind: 'select',
        options: [
          { value: 'smsto', label: 'SMSTO (most scanners)' },
          { value: 'uri', label: 'sms: link' },
        ],
      },
    ],
    defaults: { number: '+6591234567', message: '', format: 'smsto' },
    build: buildSms,
  },
  {
    type: 'phone',
    label: 'Phone call',
    fields: [{ key: 'number', label: 'Phone number', kind: 'tel' }],
    defaults: { number: '+6591234567' },
    build: buildPhone,
  },
  {
    type: 'whatsapp',
    label: 'WhatsApp',
    fields: [
      { key: 'number', label: 'Number with country code', kind: 'tel' },
      { key: 'message', label: 'Pre-filled message', kind: 'textarea' },
    ],
    defaults: { number: '6591234567', message: '' },
    build: buildWhatsApp,
  },
  {
    type: 'geo',
    label: 'Location',
    fields: [
      { key: 'lat', label: 'Latitude', kind: 'text', placeholder: '1.2834' },
      { key: 'lng', label: 'Longitude', kind: 'text', placeholder: '103.8607' },
      { key: 'label', label: 'Place name', kind: 'text', when: (f) => f.format !== 'maps' },
      {
        key: 'format',
        label: 'Opens in',
        kind: 'select',
        options: [
          { value: 'geo', label: 'Phone’s map app (geo:)' },
          { value: 'maps', label: 'Google Maps link' },
        ],
      },
    ],
    defaults: { lat: '1.2834', lng: '103.8607', label: '', format: 'geo' },
    build: buildGeo,
  },
  {
    type: 'event',
    label: 'Calendar event',
    fields: [
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'start', label: 'Starts', kind: 'datetime-local' },
      { key: 'end', label: 'Ends', kind: 'datetime-local' },
      { key: 'allDay', label: 'All day', kind: 'checkbox' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'description', label: 'Details', kind: 'textarea' },
    ],
    defaults: { title: 'Team lunch', start: '', end: '', allDay: false },
    build: buildEvent,
  },
];

export function contentDef(type: ContentType): ContentDef {
  return CONTENT_TYPES.find((c) => c.type === type) ?? CONTENT_TYPES[0];
}

export function buildPayload(type: ContentType, fields: Fields): string {
  const def = contentDef(type);
  return def.build({ ...def.defaults, ...fields });
}
