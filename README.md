# QR & Barcode Studio

A QR code and barcode generator and scanner that runs entirely in your browser and is hosted for free on GitHub Pages. Nothing you type or upload is sent anywhere. It also works offline once it has loaded, and you can install it on a phone or computer as an app.

## What it does

**QR codes**

- Content types: website, text, Wi-Fi login, contact card (vCard), email, SMS, phone call, WhatsApp, location and calendar event.
- Upload your own logo (PNG, JPG, WebP, GIF or SVG) to sit in the middle. Error correction is raised to High automatically so the code still scans.
- Styles:
  - Six dot styles, separate corner frame and centre styles, and square or circular outlines.
  - Solid or gradient colours, transparent or rounded backgrounds.
  - Quick presets.
- Technical controls: error correction (L/M/Q/H), fixed version (grid size) and quiet zone.

**Barcodes: all 111 formats in bwip-js**

- **Retail:** EAN-13, EAN-8, UPC-A, UPC-E, ISBN, ISSN and add-ons.
- **1D:** Code 128, Code 39, Code 93, Codabar, ITF / Interleaved 2 of 5, ITF-14, MSI, Telepen and more.
- **2D:** Data Matrix (square and rectangular), QR, Micro QR, rMQR, Aztec, MaxiCode, DotCode, Han Xin and Code One.
- **Stacked:** PDF417, MicroPDF417, Codablock F and Code 16K.
- **GS1 standards:** GS1-128, GS1 DataBar, GS1 Data Matrix, GS1 QR, Digital Link and composites.
- **Healthcare and postal:** HIBC, Pharmacode, PZN, USPS Intelligent Mail, Royal Mail, AusPost and Japan Post.
- **Check digits** are added for you, and invalid input gets a plain-English explanation.
- **Options:** text font, size, alignment and position; bar height in mm; colours; quiet zone; border; rotation.
- **"More options"** passes any encoder option straight to the encoder, such as `version=24x24` or `eclevel=Q`.

**Export**

- **Formats:** PNG, SVG, JPEG, WebP or PDF.
- **Size:** set it in mm, inches or pixels at any resolution (DPI).
- **Print size:** PNGs carry their DPI, and SVGs and PDFs carry their physical size, so they open at the right size in Word, Illustrator, Canva and similar apps.
- **Sharp bars:** an option that snaps each barcode bar to whole pixels for crisp printing.
- **Other actions:** copy to the clipboard, print, or copy a link that recreates your settings (logos aren't included in links).

**Batch**

- Paste a list, paste from a spreadsheet, or open a CSV file.
- Build each code from a template like `https://example.com/item/{id}`, and name files with `{name}`, `{row}` or any column.
- Download as a ZIP of images or as one PDF with a code per page. Rows that fail are listed, and a `problems.csv` is included in the ZIP.

**Label sheets**

- Presets for Avery L7160, L7163, L7165 and L7651 (A4), 5160, 5163 and 5167 (Letter), plain grids, or a fully custom layout.
- Fill the sheet with copies of one code, or one label per batch row.
- Start part-way through a used sheet, add captions, and nudge the alignment for your printer.
- Print directly or download a PDF.

**Scanner**

- Scan with the camera (back camera by default, with a camera picker and torch where the phone supports it), or from an image file: choose one, drop it on the preview, or paste a screenshot.
- **Pick the format you're scanning.** The scanner is set to QR codes by default. Type in the **Look for** box to find any of the 105 readable formats, or choose **Everything** or **Common formats**. A single format is the fastest setting and can't mistake one code for another.
- Results show what the code means: the website's address, the Wi-Fi network and password, a contact's name and number, an event's time. Then copy it, open it (only web, email, phone, SMS and map links), save a contact as `.vcf`, add an event as `.ics`, or **Edit in generator** to load it back into the QR code or Barcode tab.
- Optional beep and vibration, continuous scanning, and a history kept on the device (which you can turn off or clear).
- The installed app has a "Scan a code" shortcut on a long-press of its icon.
- Every format in the Barcode tab's list says whether the scanner can read it.
- Works on phones: the page fits the screen (only the row of tabs scrolls sideways), format menus open without the keyboard on a tap (tap again to type a search), scrolling a menu never picks an item, and text boxes don't make iOS zoom in.

### What the scanner can read

Every QR code the QR code tab makes, with any style, logo or gradient, scans. For the 111 barcode formats:

| How it's read                             | Formats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **zxing-cpp** (62 formats)                | EAN-13, EAN-8, UPC-A, UPC-E, ISBN, ISMN, ISSN, Marks & Spencer, Code 128, GS1-128, EAN-14, SSCC-18, Code 39, Code 39 Extended, Italian Pharmacode (Code 32), PZN, Code 93, Code 93 Extended, Interleaved 2 of 5, ITF-14, Deutsche Post Identcode and Leitcode, Codabar, Telepen, Telepen Numeric, all 7 GS1 DataBar types, GS1 North American Coupon, QR Code, Swiss QR, Micro QR, rMQR, GS1 QR, GS1 Digital Link QR, D3 AQR, HIBC QR, Data Matrix (square, rectangular, extended), GS1 Data Matrix (both shapes), GS1 Digital Link Data Matrix, HIBC Data Matrix (both shapes), Royal Mail Mailmark, PDF417, Compact PDF417, MicroPDF417, HIBC PDF417, HIBC MicroPDF417, Aztec, Compact Aztec, Aztec Runes, HIBC Aztec, MaxiCode, HIBC Code 39, HIBC Code 128 |
| **This app's own decoders** (28 formats)  | **1D:** Code 11, MSI Modified Plessey, Plessey UK, Code 25, Industrial 2 of 5, IATA 2 of 5, Matrix 2 of 5, COOP 2 of 5, Datalogic 2 of 5, BC412 (semi), PosiCode (A, B, limited A and B), EAN-2 and EAN-5 add-ons on their own, Pharmacode, Channel Code (3 to 8 channels), USPS FIM marks. **Postal:** USPS Intelligent Mail, POSTNET, PLANET, Royal Mail 4-State (RM4SCC), KIX, Japan Post, Australia Post, Two-track Pharmacode. **Stacked:** Code 16K, Code 49, Codablock F, HIBC Codablock F                                                                                                                                                                                                                                                              |
| **zxing-cpp + the app** (13 formats)      | All 12 GS1 composites (EAN-13/EAN-8/UPC-A/UPC-E/DataBar/GS1-128 composite) and the 2D component on its own. zxing-cpp reads the linear barcode, and the app decodes the 2D part: CC-A and small CC-B with its own row reader, and larger CC-B and CC-C from the bytes zxing-cpp returns. They come back as one result, e.g. `9520123456788\|(99)1234-abcd`.                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Only when picked under "Look for"** (2) | Custom 1D symbology and Custom 4-state symbology. Almost any bar pattern fits these, so the scanner never guesses them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Not readable yet** (6)                  | Han Xin, DotCode, GS1 DotCode, Code One and Ultracode (planned: these need full 2D decoders with error correction); Flattermarken (print-collation marks, not data).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Avoiding false reads.** A decoder that accepts anything is worse than none, so:

- **"Everything" skips formats with no check character.** Pharmacode, Two-track Pharmacode, KIX, the EAN-2/EAN-5 add-ons on their own, USPS FIM marks, Channel Code and the custom patterns can be faked by almost any row of bars (a keyboard, window blinds, lines of text). They're still read when you pick them on their own. Code 11, MSI and the 2 of 5 family are read by "Everything" only when they carry a check digit (the generator adds one by default). BC412 without start/stop bars needs its check character and at least 3 characters even when picked.
- **Quiet zones and agreement.** The app's 1D decoders only accept a read with blank space on both sides that 2 scan lines agree on (3 in "Everything").
- **Camera confirmation.** On the camera, a read is only shown once it has turned up in several frames within 1.5 seconds: 1 frame for 2D codes and stacked codes with error correction, 2 for linear codes with a check digit, 3 for formats without one (Code 39, Codabar, ITF and the pick-only formats). zxing-cpp also needs 3 scan lines to cross a 1D code on a camera frame instead of 2.
- **One format means one format.** Picking a format turns off every other decoder and checks the variant too: Swiss QR must start with `SPC`, HIBC codes with `+`, ISBN with 978 or 979, GS1 variants must carry GS1 data, and a composite pick needs the 2D part.
- **Tests.** `tests/identify.test.ts` renders every readable format with the generator's defaults and checks the scanner names it and returns the typed data, in both modes, plus tilted and blurred photos of the postal codes, stacked codes, composites and MaxiCode. `tests/false-positives.test.ts` scans a desktop screenshot, camera noise, stripes and random bars in every mode and with every single-format setting, and expects nothing; it also checks every format's scanner reads its own code.

**Formats that print the same bars.** Several formats are the same barcode with a different meaning: a UPC-A is an EAN-13 that starts with 0, an ISBN is an EAN-13 starting 978 or 979, ITF-14 and the Deutsche Post codes are Interleaved 2 of 5, PZN is Code 39 with a `-` in front. The scanner names the most likely one from the content (the prefix, the length, which check digit fits, the symbol's shape) and lists the others under **Could also be** on the result. When it's set to one format, it reads the code as that format. It also:

- **Returns the data, not the extras.** Check characters (Code 39, Codabar, Interleaved 2 of 5) and ITF's padding 0 are removed and shown separately, so the result matches what was typed into the generator. The generator no longer prints check characters in the text under the bars either.
- **Reads add-ons.** An ISBN's price or an ISSN's issue number (EAN-2/EAN-5 add-on) is read by the app's own decoder when zxing-cpp misses it, and the ISSN is rebuilt in its usual form (`0311-175X 00 17`).
- **Decodes full ASCII itself.** Code 39 Extended and Code 93 Extended are recognised by their content, and HIBC codes by their `+` and check character, so `+A99…` isn't mistaken for Code 39 Extended.
- **Edit in generator** loads the format and text that reproduce the same bars (an ISBN goes in as EAN-13 digits, since its hyphen positions can't be read from the bars).

**Tilted and blurry photos.** zxing-cpp copes with tilt itself. For the app's own decoders the scanner measures how far the bars lean and straightens the image first, and the postal reader judges each bar against a line fitted through its neighbours, so a slight remaining tilt or a bar blurring into the text below doesn't matter. MaxiCode, which zxing-cpp only reads from clean upright images, is found by its bullseye, straightened and cut out before decoding.

**How the app's own decoders work.**

- **Reading the image:** they read bar and space widths (or, for postal codes, each bar's height) along lines across the image. Stacked codes are read row by row: each row identifies its own row number, so a damaged line can be outvoted by the lines above and below it.
- **Pattern tables:** every table comes from bwip-js, the same encoder that draws the codes. Some are learned by asking it to encode each character; the others (Intelligent Mail, Channel Code, Code 16K, Code 49, Codablock F, PosiCode, MicroPDF417) are copied from its source by `scripts/extract-tables.mjs`.
- **Verification:** every read is re-encoded and compared bar for bar (row by row for stacked codes, including the error-correction codewords), so when they can't be sure they show nothing rather than wrong data.
- **Ink spread:** bars printed fatter or thinner than nominal are measured from bar+space pairs. When the spread is so heavy that two readings fit, both are tried.

**Speed.** Scanning runs in a Web Worker, so the camera preview never waits for a decoder. The app's decoders only run when zxing-cpp finds nothing (or on the frames where a composite or Codablock F is likely). Lines without real contrast are skipped. On a 1280×720 camera frame an empty search takes about 10 ms and a successful one 3–30 ms; `tests/perf.test.ts` fails the build if that regresses badly or if noise ever decodes as a barcode. Testing covers every format at several sizes, rotated, with blur and noise, and with random content.

## Put it online (one-time setup)

You need a GitHub account and [Node.js](https://nodejs.org) 20.19 or newer (the LTS version is fine).

1. **Create the repository.** On GitHub, click **New repository**. Name it whatever you like, for example `qr_barcode_generator_scanner`. Make it **Public**, because GitHub Pages on a free account only serves public repos. Don't add a README, .gitignore or licence; this project has them.

2. **Push this code.** In this folder:

   ```bash
   git init -b main        # skip if this folder is already a git repo
   git add -A
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```

3. **Turn on Pages.** In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

4. **Wait for the deploy.** Open the **Actions** tab and the "Deploy to GitHub Pages" run will start. If it ran before step 3 and failed, click **Re-run all jobs**. After a minute or two your site is live at:

   ```
   https://YOUR-USERNAME.github.io/YOUR-REPO/
   ```

   Every later push to `main` redeploys automatically.

5. **Install it on your devices (optional).** Open the address on each phone or computer:
   - **iPhone / iPad (Safari):** Share → Add to Home Screen.
   - **Android (Chrome):** menu → Install app.
   - **Desktop Chrome / Edge:** the install icon in the address bar.

   After the first visit it works without a connection.

The site's base path (`/YOUR-REPO/`) is detected during the build, so renaming the repo or adding a custom domain needs no code changes.

## Recommended repository settings

| Where                                                                  | Setting                                            | Why                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Settings → Pages                                                       | Source: **GitHub Actions**                         | Required. Builds with Vite instead of serving raw files.            |
| Settings → Pages                                                       | **Enforce HTTPS** (on by default)                  | Needed for offline mode and copy-to-clipboard.                      |
| Settings → Actions → General                                           | Workflow permissions: **Read repository contents** | The workflows ask for only the permissions they need.               |
| Settings → Advanced Security (called "Code security" on some accounts) | **Dependabot alerts** and **security updates** on  | Pairs with `.github/dependabot.yml`, which opens weekly update PRs. |
| Settings → Branches (optional)                                         | Protect `main`: require the **CI / check** status  | Stops a broken update from deploying. Dependabot PRs run CI first.  |
| Settings → General (optional)                                          | Untick Wikis, Projects and Discussions             | Keeps a personal repo tidy.                                         |

### Custom domain (optional)

1. Add the domain under **Settings → Pages → Custom domain**.
2. At your DNS provider, add a `CNAME` record pointing to `YOUR-USERNAME.github.io`. For an apex domain, use `A` records to GitHub's Pages IPs instead; see GitHub's "Managing a custom domain" docs.
3. Tick **Enforce HTTPS** once the certificate is issued.

## Working on it locally

```bash
npm install
npm run dev          # http://localhost:5173 with live reload
```

| Command                           | What it does                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Development server                                                                                                                                 |
| `npm run build`                   | Write `public/THIRD_PARTY_LICENSES.txt`, type-check and build into `dist/`                                                                         |
| `npm run licenses`                | Only rewrite `public/THIRD_PARTY_LICENSES.txt` from the installed packages                                                                         |
| `npm run preview`                 | Serve the built site                                                                                                                               |
| `npm test`                        | Unit tests, including scan-back tests that decode generated codes with zxing-cpp                                                                   |
| `npm run test:e2e`                | Builds must exist first. Drives every tab in headless Chrome and checks the downloads scan                                                         |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                                                                                  |
| `npm run icons`                   | Redraw the app icons (needs Python with Pillow)                                                                                                    |
| `node scripts/extract-tables.mjs` | Re-copy the decoders' pattern tables (Intelligent Mail, Channel Code, Code 16K, Code 49, Codablock F, PosiCode, MicroPDF417) from bwip-js's source |

**Recommended editor:** VS Code with the ESLint and Prettier extensions.

## How it fits together

```
index.html             page shell (tabs, panels, footer)
src/
  main.ts              tab switching, saving settings, theme, offline updates
  state.ts             all settings, defaults, local storage, share links
  generators.ts        one interface over QR + barcode rendering
  qr/                  content builders (Wi-Fi, vCard, …), styling, settings panel
  barcode/             format catalogue, bwip-js options, settings panel
  export/              sizing, PNG DPI metadata, downloads, clipboard, PDF
  batch/               CSV parsing, templates, ZIP output
  print/               label presets, layout maths, print + PDF sheets
  ui/                  small DOM helpers, preview and export panel
  scan/                scanner tab, worker, zxing-cpp loader, GS1 composite bits, result interpretation, support list
    extra/             the app's own decoders (1D, postal 4-state, stacked, CC-A/CC-B rows)
tests/                 unit and scan-back tests (Vitest)
scripts/               smoke test, icon drawing, licence collection
.github/               deploy + CI workflows, Dependabot
```

**Libraries**

- [qr-code-styling](https://github.com/kozakdenys/qr-code-styling): styled QR codes and logos.
- [bwip-js](https://github.com/metafloor/bwip-js): every other format.
- [jsPDF](https://github.com/parallax/jsPDF): PDFs.
- [JSZip](https://github.com/Stuk/jszip): ZIP files.
- [Papa Parse](https://www.papaparse.com): CSV parsing.
- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm): [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) compiled to WebAssembly, for scanning. The `.wasm` file ships with the site, so it isn't fetched from a CDN.
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app): offline support.

The large libraries only load when you first use the tab that needs them.

## Privacy and security

- **No server, no tracking, no cookies.** Settings and your logo are saved in your browser's local storage on each device. Use **Reset all settings** in the footer to clear them.
- **Locked-down page.** The built page carries a Content-Security-Policy that only allows its own scripts and blocks connections to other sites. GitHub Pages can't send HTTP headers, so the policy goes in a `<meta>` tag.
- **The camera stays local.** Frames are decoded in the page and never stored or sent. The camera only runs while the Scan tab is open, and stops after each find unless you turn on continuous scanning. Browsers only allow the camera on HTTPS, which GitHub Pages provides.
- **Scanned links are never opened automatically.** Only web, email, phone, SMS and map links get an Open button. Anything else (for example `javascript:`) can only be copied.
- **WebAssembly needs one security-policy allowance**, `'wasm-unsafe-eval'`, so the scanning engine can run. It doesn't allow JavaScript `eval`.
- **Share links are readable.** They contain your settings, encoded but not encrypted. Don't share a link to a Wi-Fi code if the password is private.

## Licence

The app's code is released under the **BSD Zero Clause License (0BSD)**: anyone may use, copy, modify and share it for any purpose, with no conditions.

**Why 0BSD:** this code was written by an AI (Claude). In the US, the Copyright Office's current position is that purely AI-generated material isn't protected by copyright; only human-authored parts are. A licence that demands attribution or other conditions would lean on a copyright claim that may not exist. 0BSD asks for nothing, so it is honest whatever the legal status turns out to be, and it still gives everyone, including you, clear permission plus the standard warranty disclaimer. It is OSI-approved and recognised by GitHub. (This isn't legal advice. If you later write substantial parts yourself, you can relicense your own contributions however you like.)

The bundled libraries keep their own licences: MIT for the JavaScript libraries, Apache 2.0 for zxing-cpp inside the scanner's `.wasm` file, and the SIL Open Font License for the Archivo font. All are compatible with 0BSD for your own code. Their notices, including the full Apache 2.0 text, are in `public/THIRD_PARTY_LICENSES.txt` (rewritten by every build and by `npm run dev`). The **Licences** button in the footer shows both files in the app, and works offline.

## Troubleshooting

- **The site is a blank page or has no styling.** The build couldn't work out the base path. Make sure Pages' source is **GitHub Actions**, not "Deploy from a branch", then re-run the workflow.
- **The deploy job fails with "Get Pages site failed".** Pages isn't turned on yet. Do step 3 above, then re-run.
- **A code with a logo won't scan.** Shrink the logo below about 30%, keep error correction on High, and keep good contrast between dots and background.
- **Labels print out of line.** In the print dialog, set scale to 100% / "Actual size" and margins to "None". Then use the nudge settings, and check the sheet layout against the label maker's template.
- **The camera won't start.** Allow camera access for the site in the browser's settings. On iPhone, use Safari or install the app to the home screen. If another app is using the camera, close it. You can always scan from an image file instead.
- **A barcode won't scan.** Check **Look for** first: it's set to QR codes by default, so pick the barcode's format (or **Everything**). Then move closer so the code fills the box, keep it flat and straight, and add light (try the torch). For the formats the app decodes itself, a sharp, straight-on photo or a screenshot works best.
- **A new version doesn't appear.** The app is cached for offline use and checks for updates every hour and whenever you return to it, then shows an "Update" prompt. To update straight away, click **Clear cache and reload** at the bottom of the page: it removes the cached copy and loads the latest version. The version and build time are shown next to it.
