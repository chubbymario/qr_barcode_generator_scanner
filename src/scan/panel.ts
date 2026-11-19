import type { ScanRecord, ScanSettings } from '../state';
import type { PanelContext } from '../qr/panel';
import { button, checkbox, field, h, section, segmented, select, toast } from '../ui/dom';
import { combobox, type ComboOption } from '../ui/combobox';
import { CATEGORIES } from '../barcode/catalog';
import { SYMBOL_NAMES } from '../barcode/names';
import { PICK_ONLY, SCANNABLE } from './targets';
import { UNSUPPORTED_FORMATS } from './support';
import { downloadBlob } from '../export/files';
import type { ScanResult } from './engine';
import { EXTRA_FORMATS } from './lists';
import { scan, warmUp } from './client';
import { EXTRA_LABELS } from './formats';
import { interpret, safeHref } from './interpret';

const MAX_FRAME = 1280; // camera frames are scaled to this before decoding
const MAX_IMAGE = 2400; // uploaded images
const HISTORY_LIMIT = 30;

export function buildScanPanel(ctx: PanelContext): {
  controls: HTMLElement;
  stage: HTMLElement;
  refresh: () => void;
  dispose: () => void;
} {
  const sc = ctx.get().scan;
  const set = (fn: (s: ScanSettings) => void, rebuild = false) =>
    ctx.update((s) => fn(s.scan), { rebuild });

  // ---------- stage elements ----------
  const video = h('video', {
    class: 'scan-video',
    playsinline: true,
    muted: true,
    'aria-label': 'Camera view',
  });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const shown = h('canvas', { class: 'scan-image', 'aria-hidden': 'true' });
  const overlay = h('canvas', { class: 'scan-overlay', 'aria-hidden': 'true' });
  const frame = h('div', { class: 'scan-frame', 'aria-hidden': 'true' });
  const hint = h('p', { class: 'scan-hint' });
  const viewport = h(
    'div',
    { class: `scan-viewport ${sc.source}` },
    video,
    shown,
    overlay,
    frame,
    hint,
  );
  const status = h('p', { class: 'status', 'aria-live': 'polite' });
  const resultsEl = h('div', { class: 'scan-results', 'aria-live': 'polite' });
  const startBtn = button('Start camera', () => void startCamera(), { kind: 'primary' });
  const stopBtn = button('Stop camera', () => stopCamera(), { kind: 'plain' });
  const torchBtn = button('Torch', () => void toggleTorch(), { kind: 'quiet' });
  const againBtn = button('Scan again', () => void startCamera(), { kind: 'primary' });
  stopBtn.hidden = torchBtn.hidden = againBtn.hidden = true;
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' });
  const pickBtn = h('label', { class: 'btn primary file' }, fileInput, 'Choose an image');

  // ---------- results ----------
  let lastKey = '';
  let lastAt = 0;

  // A camera read is shown only once enough frames in a row agree (see
  // framesNeeded), so a pattern that fools a decoder in one blurry frame
  // doesn't count. Reads not seen again within CONFIRM_MS are forgotten.
  const CONFIRM_MS = 1500;
  const sightings = new Map<string, { count: number; at: number }>();
  function confirmed(results: ScanResult[]): ScanResult[] {
    const now = Date.now();
    for (const [k, v] of sightings) if (now - v.at > CONFIRM_MS) sightings.delete(k);
    return results.filter((r) => {
      const key = `${r.bcid}\u0000${r.text}`;
      const seen = sightings.get(key);
      const count = (seen?.count ?? 0) + 1;
      sightings.set(key, { count, at: now });
      return count >= (r.frames ?? 1);
    });
  }

  function addToHistory(r: ScanResult) {
    if (!ctx.get().scan.keepHistory) return;
    ctx.update((s) => {
      const rec: ScanRecord = { text: r.text, label: r.label, bcid: r.bcid, at: Date.now() };
      s.scan.history = [
        rec,
        ...s.scan.history.filter((x) => x.text !== r.text || x.label !== r.label),
      ].slice(0, HISTORY_LIMIT);
    });
    drawHistory();
  }

  function feedback() {
    if (!ctx.get().scan.feedback) return;
    try {
      navigator.vibrate?.(60);
      const ac = new AudioContext();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 1320;
      g.gain.setValueAtTime(0.08, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
      o.connect(g).connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.13);
      o.onended = () => void ac.close();
    } catch {
      /* sound isn't essential */
    }
  }

  function showResults(results: ScanResult[], prepend = false) {
    const cards = results.map(resultCard);
    if (prepend) resultsEl.prepend(...cards);
    else resultsEl.replaceChildren(...cards);
    while (resultsEl.children.length > 12) resultsEl.lastElementChild?.remove();
  }

  function resultCard(r: ScanResult): HTMLElement {
    const info = interpret(r.text);
    const href = safeHref(info.href);
    const actions: HTMLElement[] = [
      button('Copy text', async () => {
        try {
          await navigator.clipboard.writeText(r.text);
          toast('Copied.');
        } catch {
          toast('Couldn’t copy. Your browser blocked clipboard access.', 'error');
        }
      }),
    ];
    if (href) {
      const label =
        info.type === 'url'
          ? `Open ${new URL(href).host}`
          : info.type === 'geo'
            ? 'Open map'
            : info.type === 'email'
              ? 'Write email'
              : info.type === 'phone'
                ? 'Call'
                : info.type === 'sms'
                  ? 'Send SMS'
                  : 'Open';
      actions.push(
        h('a', { class: 'btn plain', href, target: '_blank', rel: 'noopener noreferrer' }, label),
      );
    }
    if (info.type === 'wifi' && info.fields.password) {
      actions.push(
        button('Copy password', async () => {
          await navigator.clipboard.writeText(String(info.fields.password)).catch(() => undefined);
          toast('Password copied.');
        }),
      );
    }
    if (info.type === 'vcard') {
      actions.push(
        button('Save contact', () =>
          downloadBlob(new Blob([r.text], { type: 'text/vcard' }), 'contact.vcf'),
        ),
      );
    }
    if (info.type === 'event') {
      const ics = /BEGIN:VCALENDAR/i.test(r.text)
        ? r.text
        : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//QR & Barcode Studio//EN\r\n${r.text.trim()}\r\nEND:VCALENDAR\r\n`;
      actions.push(
        button('Add to calendar', () =>
          downloadBlob(new Blob([ics], { type: 'text/calendar' }), 'event.ics'),
        ),
      );
    }
    const editId = r.edit?.bcid ?? r.bcid;
    const editText = r.edit?.text ?? r.text;
    if (editId) {
      actions.push(
        button(
          'Edit in generator',
          () =>
            ctx.update(
              (s) => {
                if (editId === 'qrcode') {
                  s.qr.contentType = info.type;
                  s.qr.fields[info.type] = { ...s.qr.fields[info.type], ...info.fields };
                  s.tab = 'qr';
                } else {
                  s.barcode.bcid = editId;
                  s.barcode.texts[editId] = editText;
                  s.tab = 'barcode';
                }
              },
              { rebuild: true },
            ),
          { kind: 'quiet' },
        ),
      );
    }
    // Show control characters (e.g. GS1 separators) as visible symbols.
    // eslint-disable-next-line no-control-regex
    const visible = r.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) =>
      String.fromCharCode(0x2400 + c.charCodeAt(0)),
    );
    return h(
      'article',
      { class: 'scan-card' },
      h(
        'header',
        {},
        h('h3', {}, r.label),
        r.engine === 'app' ? h('span', { class: 'tag' }, 'App decoder') : null,
      ),
      info.summary.length || r.details?.length
        ? h(
            'dl',
            {},
            [...(r.details ?? []), ...info.summary].flatMap(([k, v]) => [
              h('dt', {}, k),
              h('dd', {}, v),
            ]),
          )
        : null,
      h('pre', { class: 'payload' }, visible),
      r.alternatives?.length
        ? h(
            'details',
            { class: 'alternatives' },
            h('summary', {}, `Could also be ${r.alternatives.map((a) => a.label).join(', ')}`),
            h(
              'p',
              { class: 'hint' },
              'These formats print the same bars, so the scanner shows the most common reading. Pick the format under “Look for” to read it as that.',
            ),
            h(
              'dl',
              {},
              r.alternatives.flatMap((a) => [h('dt', {}, a.label), h('dd', {}, a.text)]),
            ),
          )
        : null,
      h('div', { class: 'actions' }, actions),
    );
  }

  function drawOutlines(results: ScanResult[], scale: number, w: number, hgt: number) {
    overlay.width = w;
    overlay.height = hgt;
    const g = overlay.getContext('2d')!;
    g.clearRect(0, 0, w, hgt);
    g.lineWidth = Math.max(3, w / 200);
    g.strokeStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--mark') || '#c81f63';
    for (const r of results) {
      if (!r.corners) continue;
      g.beginPath();
      r.corners.forEach((p, i) =>
        i ? g.lineTo(p.x * scale, p.y * scale) : g.moveTo(p.x * scale, p.y * scale),
      );
      g.closePath();
      g.stroke();
    }
  }

  // ---------- camera ----------
  let stream: MediaStream | null = null;
  let cameraToken = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let frameNo = 0;
  const grab = h('canvas');

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = window.isSecureContext
        ? 'This browser can’t use the camera. Choose an image instead.'
        : 'The camera only works over HTTPS. Open the site’s https:// address, or choose an image instead.';
      status.classList.add('error');
      return;
    }
    stopCamera();
    againBtn.hidden = true;
    viewport.classList.remove('frozen');
    overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
    status.classList.remove('error');
    status.textContent = 'Starting the camera…';
    warmUp(); // load the scanning engine while the camera starts
    const id = ctx.get().scan.deviceId;
    // A newer start (or a stop) supersedes this one while it waits.
    const mine = ++cameraToken;
    let local: MediaStream;
    try {
      local = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch (err) {
      if (mine !== cameraToken) return;
      const name = (err as DOMException).name;
      status.textContent =
        name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow it in your browser’s site settings, or choose an image instead.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No camera was found. Choose an image instead.'
            : `The camera couldn’t start (${name || 'unknown error'}).`;
      status.classList.add('error');
      return;
    }
    if (mine !== cameraToken) {
      local.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = local;
    video.srcObject = local;
    await video.play().catch(() => undefined);
    if (mine !== cameraToken) return;
    running = true;
    frameNo = 0;
    viewport.classList.add('live');
    startBtn.hidden = true;
    stopBtn.hidden = false;
    const track = local.getVideoTracks()[0];
    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    torchBtn.hidden = !caps.torch;
    status.textContent = 'Point the camera at a code.';
    void fillCameraList();
    loop();
  }

  function stopCamera() {
    cameraToken++;
    running = false;
    viewport.classList.remove('live');
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    startBtn.hidden = false;
    stopBtn.hidden = torchBtn.hidden = true;
  }

  let torchOn = false;
  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn } as MediaTrackConstraintSet] });
      torchBtn.textContent = torchOn ? 'Torch off' : 'Torch';
    } catch {
      toast('The torch couldn’t be switched.', 'error');
    }
  }

  async function loop() {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth) {
      frameNo++;
      const scale = Math.min(1, MAX_FRAME / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.round(video.videoWidth * scale);
      const hh = Math.round(video.videoHeight * scale);
      grab.width = w;
      grab.height = hh;
      const g = grab.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(video, 0, 0, w, hh);
      const img = g.getImageData(0, 0, w, hh);
      const lookFor = ctx.get().scan.format;
      try {
        // Thorough settings every third frame. In "Everything" mode the app's
        // own decoders run every other frame, so confirmations still line up.
        const raw = await scan(img, {
          lookFor,
          fast: frameNo % 3 !== 0,
          extras: frameNo % 2 === 0,
          live: true,
        });
        if (!running) return;
        const results = confirmed(raw);
        drawOutlines(results, 1 / scale, video.videoWidth, video.videoHeight);
        if (results.length) {
          const key = results.map((r) => r.label + r.text).join('|');
          const now = Date.now();
          if (key !== lastKey || now - lastAt > 3000) {
            lastKey = key;
            lastAt = now;
            feedback();
            showResults(results, ctx.get().scan.continuous);
            results.forEach(addToHistory);
            status.textContent = `Found ${results.length === 1 ? results[0].label : `${results.length} codes`}.`;
            if (!ctx.get().scan.continuous) {
              // Freeze the frame the code was found in, with its outline.
              shown.width = video.videoWidth;
              shown.height = video.videoHeight;
              shown.getContext('2d')!.drawImage(video, 0, 0);
              viewport.classList.add('frozen');
              stopCamera();
              startBtn.hidden = true;
              againBtn.hidden = false;
              return;
            }
          }
        }
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        status.classList.add('error');
      }
    }
    timer = setTimeout(() => void loop(), 60);
  }

  const cameraSelect = select([{ value: '', label: 'Back camera (default)' }], sc.deviceId, (v) => {
    set((s) => (s.deviceId = v));
    if (running) void startCamera();
  });
  async function fillCameraList() {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === 'videoinput',
    );
    const current = ctx.get().scan.deviceId;
    cameraSelect.replaceChildren(
      h('option', { value: '' }, 'Back camera (default)'),
      ...devices.map((d, i) => h('option', { value: d.deviceId }, d.label || `Camera ${i + 1}`)),
    );
    cameraSelect.value = devices.some((d) => d.deviceId === current) ? current : '';
  }

  // ---------- images ----------
  async function scanFile(file: Blob) {
    if (!file.type.startsWith('image/')) {
      toast('That isn’t an image file.', 'error');
      return;
    }
    status.classList.remove('error');
    status.textContent = 'Reading the image…';
    resultsEl.replaceChildren();
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_IMAGE / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const hh = Math.round(bmp.height * scale);
      shown.width = w;
      shown.height = hh;
      const g = shown.getContext('2d', { willReadFrequently: true })!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, hh);
      g.drawImage(bmp, 0, 0, w, hh);
      bmp.close();
      viewport.classList.add('has-image');
      const img = g.getImageData(0, 0, w, hh);
      const results = await scan(img, { lookFor: ctx.get().scan.format });
      drawOutlines(results, 1, w, hh);
      if (results.length) {
        feedback();
        showResults(results);
        results.forEach(addToHistory);
        status.textContent = `Found ${results.length === 1 ? results[0].label : `${results.length} codes`}.`;
      } else {
        status.textContent =
          ctx.get().scan.format === 'auto'
            ? 'No code found. Try a sharper or closer image, or pick the format under “Look for”: a few formats are only read when picked.'
            : 'No code of that format found. Try a sharper or closer image, or pick another format under “Look for”.';
      }
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'That image couldn’t be read.';
      status.classList.add('error');
    }
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void scanFile(f);
    fileInput.value = '';
  });
  viewport.addEventListener('dragover', (e) => {
    e.preventDefault();
    viewport.classList.add('drag');
  });
  viewport.addEventListener('dragleave', () => viewport.classList.remove('drag'));
  viewport.addEventListener('drop', (e) => {
    e.preventDefault();
    viewport.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      if (ctx.get().scan.source !== 'image') set((s) => (s.source = 'image'), true);
      void scanFile(f);
    }
  });
  const onPaste = (e: ClipboardEvent) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) {
      e.preventDefault();
      void scanFile(f);
    }
  };
  document.addEventListener('paste', onPaste);

  // ---------- controls ----------
  const lookOptions: ComboOption[] = [
    {
      value: 'auto',
      label: 'Everything',
      group: 'Several formats',
      keywords: 'all any auto',
      note: 'slower',
    },
    {
      value: 'standard',
      label: 'Common formats',
      group: 'Several formats',
      keywords: 'zxing standard fast',
    },
  ];
  const seen = new Set<string>();
  for (const cat of CATEGORIES) {
    if (cat.name === 'Popular') continue;
    for (const id of cat.ids) {
      if (seen.has(id) || !SCANNABLE.has(id)) continue;
      seen.add(id);
      lookOptions.push({
        value: id,
        label: SYMBOL_NAMES[id] ?? EXTRA_LABELS[id] ?? id,
        group: cat.name,
        keywords: `${id} ${EXTRA_LABELS[id] ?? ''}`,
        note: PICK_ONLY.has(id)
          ? 'only when picked'
          : EXTRA_FORMATS.includes(id)
            ? 'app decoder'
            : undefined,
      });
    }
  }
  // Popular formats first, so the common picks are at the top of the list.
  const popular = CATEGORIES.find((c) => c.name === 'Popular')!.ids.filter((id) =>
    SCANNABLE.has(id),
  );
  lookOptions.splice(
    2,
    0,
    ...popular.map((id) => ({ ...lookOptions.find((o) => o.value === id)!, group: 'Popular' })),
  );
  const notYet = Object.keys(UNSUPPORTED_FORMATS).filter((id) => id !== 'flattermarken');
  const lookSelect = combobox({
    options: lookOptions,
    value: lookOptions.some((o) => o.value === sc.format) ? sc.format : 'qrcode',
    onChange: (v) => {
      sightings.clear();
      set((s) => (s.format = v));
    },
    placeholder: 'Search formats',
  });
  lookSelect.id = 'scan-format';

  const historyList = h('ol', { class: 'history' });
  function drawHistory() {
    const items = ctx.get().scan.history;
    historyList.replaceChildren(
      ...items.map((rec) =>
        h(
          'li',
          {},
          button(
            '',
            () =>
              showResults([{ text: rec.text, label: rec.label, bcid: rec.bcid, engine: 'zxing' }]),
            { kind: 'quiet' },
          ),
        ),
      ),
    );
    historyList.querySelectorAll('li').forEach((li, i) => {
      const rec = items[i];
      const b = li.querySelector('button')!;
      b.replaceChildren(
        h('span', { class: 'h-label' }, rec.label),
        h('span', { class: 'h-text' }, rec.text.slice(0, 80)),
        h('time', { datetime: new Date(rec.at).toISOString() }, new Date(rec.at).toLocaleString()),
      );
    });
    if (!items.length)
      historyList.replaceChildren(h('li', { class: 'hint' }, 'Nothing scanned yet.'));
  }
  drawHistory();

  const cameraBits = h(
    'div',
    { class: 'subfields' },
    field('Camera', cameraSelect),
    checkbox('Keep scanning after a find', sc.continuous, (v) => set((s) => (s.continuous = v))),
  );
  cameraBits.hidden = sc.source !== 'camera';
  const imageBits = h(
    'div',
    { class: 'subfields' },
    h('div', { class: 'chips' }, pickBtn),
    h(
      'p',
      { class: 'hint' },
      'Or drop an image on the preview, or paste one with Ctrl+V / ⌘V. Screenshots and photos both work.',
    ),
  );
  imageBits.hidden = sc.source !== 'image';

  const controls = h(
    'div',
    { class: 'panel-body' },
    section(
      'Scan from',
      true,
      segmented(
        'src',
        [
          { value: 'camera', label: 'Camera' },
          { value: 'image', label: 'Image file' },
        ],
        sc.source,
        (v) => {
          if (v === 'image') stopCamera();
          set((s) => (s.source = v as ScanSettings['source']), true);
        },
      ),
      cameraBits,
      imageBits,
      checkbox('Beep and vibrate on a find', sc.feedback, (v) => set((s) => (s.feedback = v))),
    ),
    section(
      'Look for',
      true,
      field(
        'Format',
        lookSelect,
        `Picking the format you’re scanning is fastest and avoids false reads. “Everything” skips formats with no check digit (Pharmacode, KIX, EAN add-ons, FIM, Channel Code, custom patterns): pick those on their own. Not readable yet: ${notYet.map((id) => SYMBOL_NAMES[id] ?? id).join(', ')}.`,
      ),
    ),
    section(
      'History',
      false,
      checkbox('Remember scans on this device', sc.keepHistory, (v) =>
        set((s) => (s.keepHistory = v)),
      ),
      historyList,
      button(
        'Clear history',
        () => {
          set((s) => (s.history = []));
          drawHistory();
        },
        { kind: 'quiet' },
      ),
    ),
  );

  hint.textContent = sc.source === 'camera' ? 'Fill the box with the code' : 'Drop an image here';
  const stage = h(
    'div',
    { class: 'stage-inner scan-stage' },
    viewport,
    h(
      'div',
      { class: 'stage-head' },
      status,
      h(
        'div',
        { class: 'actions' },
        ...(sc.source === 'camera' ? [startBtn, againBtn, stopBtn, torchBtn] : []),
      ),
    ),
    resultsEl,
  );

  let started = false;
  return {
    controls,
    stage,
    refresh: () => {
      // Start the camera straight away if permission was already given.
      if (started || ctx.get().scan.source !== 'camera') return;
      started = true;
      void navigator.permissions
        ?.query({ name: 'camera' as PermissionName })
        .then((p) => p.state === 'granted' && void startCamera())
        .catch(() => undefined);
    },
    dispose: () => {
      stopCamera();
      document.removeEventListener('paste', onPaste);
    },
  };
}
