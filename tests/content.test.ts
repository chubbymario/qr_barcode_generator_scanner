import { describe, expect, it } from 'vitest';
import {
  buildEmail,
  buildEvent,
  buildGeo,
  buildPayload,
  buildSms,
  buildVCard,
  buildWhatsApp,
  buildWifi,
  CONTENT_TYPES,
  escapeWifi,
  toICalDate,
} from '../src/qr/content';

describe('QR content builders', () => {
  it('adds https:// to bare web addresses but keeps other schemes', () => {
    expect(buildPayload('url', { url: 'example.com' })).toBe('https://example.com');
    expect(buildPayload('url', { url: 'http://a.test' })).toBe('http://a.test');
    expect(buildPayload('url', { url: 'mailto:x@y.z' })).toBe('mailto:x@y.z');
    expect(buildPayload('url', { url: '   ' })).toBe('');
  });

  it('escapes Wi-Fi special characters', () => {
    expect(escapeWifi('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f');
    expect(buildWifi({ ssid: 'Home', security: 'WPA', password: 'pw;1', hidden: false })).toBe(
      'WIFI:T:WPA;S:Home;P:pw\\;1;;',
    );
    expect(buildWifi({ ssid: 'Open', security: 'nopass', password: 'ignored', hidden: true })).toBe(
      'WIFI:T:nopass;S:Open;H:true;;',
    );
  });

  it('builds a vCard 3.0 with escaped values and CRLF line endings', () => {
    const v = buildVCard({ firstName: 'Ana', lastName: 'Ng', org: 'A, B; C', note: 'two\nlines' });
    expect(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Ng;Ana;;;\r\nFN:Ana Ng')).toBe(true);
    expect(v).toContain('ORG:A\\, B\\; C');
    expect(v).toContain('NOTE:two\\nlines');
    expect(v.endsWith('END:VCARD')).toBe(true);
  });

  it('builds mailto links with %20 spaces', () => {
    expect(buildEmail({ to: 'a@b.c', subject: 'Hi there', body: '' })).toBe(
      'mailto:a@b.c?subject=Hi%20there',
    );
    expect(buildEmail({ to: 'a@b.c' })).toBe('mailto:a@b.c');
  });

  it('builds SMS in both formats', () => {
    expect(buildSms({ number: '+65 9123-4567', message: 'Hi', format: 'smsto' })).toBe(
      'SMSTO:+6591234567:Hi',
    );
    expect(buildSms({ number: '123', message: 'a b', format: 'uri' })).toBe('sms:123?body=a%20b');
  });

  it('builds WhatsApp and geo links', () => {
    expect(buildWhatsApp({ number: '+65 9123 4567', message: 'Hello!' })).toBe(
      'https://wa.me/6591234567?text=Hello!',
    );
    expect(buildGeo({ lat: '1.5', lng: '2.5', label: '', format: 'geo' })).toBe('geo:1.5,2.5');
    expect(buildGeo({ lat: '1.5', lng: '2.5', format: 'maps' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=1.5%2C2.5',
    );
  });

  it('builds calendar events, including all-day ones', () => {
    expect(toICalDate('2026-11-18T09:30', false)).toBe('20261118T093000');
    expect(toICalDate('2026-11-18T09:30', true)).toBe('20261118');
    const e = buildEvent({
      title: 'Stand-up',
      start: '2026-11-18T09:30',
      end: '2026-11-18T09:45',
      allDay: false,
    });
    expect(e).toBe(
      'BEGIN:VEVENT\r\nSUMMARY:Stand-up\r\nDTSTART:20261118T093000\r\nDTEND:20261118T094500\r\nEND:VEVENT',
    );
    expect(buildEvent({ title: 'Holiday', start: '2026-12-25T00:00', allDay: true })).toContain(
      'DTSTART;VALUE=DATE:20261225',
    );
  });

  it('every content type produces something from its defaults', () => {
    for (const def of CONTENT_TYPES) {
      if (def.type === 'event') continue; // no default date
      expect(buildPayload(def.type, {}), def.type).not.toBe('');
    }
  });
});
