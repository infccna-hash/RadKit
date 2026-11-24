# RadKit — espace de travail du radiologue

Self-hosted teleradiology workspace. The radiologist uses it as a daily "swiss knife":
import any DICOM in one gesture, let patient files build themselves from the metadata,
share an anonymized case with a colleague, and return reports to the clinics that send studies.

```
                    ┌──────────── your Ubuntu server ─────────────────────────────┐
 Browser ──:80────► │ nginx ─┬─ /            React app (radiologist / clinic / admin)│
                    │        ├─ /api/        Express API ──► PostgreSQL              │
                    │        └─ /dicom-web/  auth_request ─► API check ─► Orthanc    │
 Browser ──:8081──► │ nginx ─┬─ /            OHIF viewer                             │
                    │        └─ /dicom-web/  (same gate)                             │
                    └───────────────────────────────────────────────────────────────┘
```

Orthanc is never exposed. Every image request is checked per study: a radiologist sees his studies,
a clinic sees the studies it sent, a share link opens only its anonymized copy.

## What v1 does

**Radiologist**
- Import a folder, a CD (DICOMDIR skipped), loose files or ZIP archives — drag and drop, parallel upload with retry.
- Patients are created automatically from DICOM tags, in a **"to validate"** state: keep or remove (removing deletes the studies too).
- Same PatientID + issuer + compatible name → attached to the existing file automatically.
- Otherwise a **merge suggestion** when names match despite transliteration (Mohamed / Mohammed / Mhamed, Benali / Ben Ali, Abdelkader / Abd El Kader) and the birth date agrees. Nothing is ever merged without a click.
- Worklist with urgent-first sorting, filters (personal / from clinics, modality, search), priors on each study.
- Report editor: modality templates, autosave, validate & sign, reopen, print / PDF.
- **Anonymized sharing**: a de-identified copy is created in Orthanc (original untouched), revocable link, expiry, optional report, colleague replies without an account, WhatsApp button. US/SC/XA… and `BurnedInAnnotation=YES` trigger a mandatory "I checked the pixels" confirmation.
- Clinic accounts: create, link, detach.

**Lightweight viewer (no WebGL)** — OHIF needs WebGL2, which many clinic PCs don't have (old drivers, remote desktop, VMs).
RadKit detects this and opens its own viewer instead: frames are rendered and windowed by Orthanc, with slice scrolling
(wheel, keys, slider, touch), window/level with live feedback, CT presets, zoom/pan, invert and length measurement in mm.
Also available on demand ("Légère" button) and on share links. Same per-study / per-share access checks.

**Clinic (client)**
- Send studies to its radiologist with clinical info and priority — no patient form, everything is read from DICOM.
- Track status, view images, download, read and print validated reports.
- Patient history grouped by patient.

**AI (DeepSeek, optional)** — only two time-savers for now: structure the radiologist's rough notes into a report draft (never invents findings), and a plain-language version for the patient in French or Arabic. Only modality, description, age, sex, clinical indication and notes are sent — never name, ID, birth date or institution. Disabled if `DEEPSEEK_API_KEY` is empty.

**Admin** — accounts, password resets, access journal (logins, views, downloads, shares, AI calls).

## Install on the Ubuntu server

```bash
# Docker + compose plugin if not present
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out / in once

unzip radkit.zip && cd radkit
./scripts/init.sh                # asks host/IP, admin email, DeepSeek key → writes .env with random secrets
docker compose up -d --build
docker compose logs -f api       # "RadKit API on :4000"
```

Open `http://<host>/`, log in with the admin email and the password printed by `init.sh`,
change it, then create the radiologist account(s). Radiologists create their clinics' accounts themselves.

Ports: **80** (app) and **8081** (viewer). Use an address that does not change (the Tailscale IP) as the host in `init.sh`:
if `PUBLIC_APP_URL` points to an IP that changed, share links break and the viewer opens on another host than your
session cookie (« session expirée »). You can also leave `PUBLIC_APP_URL` / `PUBLIC_VIEWER_URL` empty: links are then
built from the address the browser used.

### HTTPS (recommended before real patient data)
Put Caddy or a TLS-terminating nginx in front of ports 80/8081 (or use `tailscale serve`), then in `.env` set
`COOKIE_SECURE=true` and the `https://` URLs for `PUBLIC_APP_URL` / `PUBLIC_VIEWER_URL`, and `docker compose up -d`.

### Receiving directly from modalities
Uncomment `ports: ["4242:4242"]` under `orthanc`. Studies received by C-STORE land in Orthanc but are not yet
assigned to a workspace — import them from the UI for now (see roadmap).

### Backups
```bash
docker compose exec db pg_dump -U radkit radkit | gzip > radkit-$(date +%F).sql.gz
docker run --rm -v radkit_orthanc-data:/d -v $PWD:/b alpine tar czf /b/orthanc-$(date +%F).tgz -C /d .
```

## Develop locally

```bash
# API (needs Postgres and an Orthanc on :8042)
cd api && npm install
DATABASE_URL=postgres://... JWT_SECRET=dev ORTHANC_URL=http://localhost:8042 npm run dev
# Web
cd web && npm install && npm run dev      # http://localhost:5173, proxies /api to :4000
```

## Tests

One command, nothing to install but Docker:

```bash
./scripts/test.sh            # throwaway Postgres in RAM + test container, exit code = result
./scripts/test.sh --local    # without Docker: Node 20+, python3 + pydicom + numpy, TEST_DATABASE_URL set
```

The suite runs the real API against a real PostgreSQL with a mock Orthanc and a mock DeepSeek: auth & CSRF,
clinic linking, upload → patient creation / attach / merge suggestion, reports and client visibility, AI never
receiving identifiers, background share preparation (preparing → ready, failure never served), burned-in guard,
per-study DICOMweb gate, lite viewer access rules, immediate revocation, patient removal, and robustness probes
(37 malformed requests must never give a 500, upstream dying mid-download, migration lock, DB time zone); plus name-matcher unit tests.

What each kind of test checks (and what decides "failed"):

| File | Method (who makes the inputs) | Oracle (who decides it failed) |
|---|---|---|
| `e2e.test.js` | fixed scripted workflow | example assertions, access rules |
| `e2e.test.js` de-identification | metamorphic pair: same study with / without the patient's identity typed into free text | no canary anywhere in the share; clean descriptions kept |
| `properties.test.js` | seeded random studies (interleaved upload, duplicate InstanceNumbers, multi-frame), random names/descriptions | invariants: each series = exactly its own frames, ordered, deterministic; scrub removes identity and keeps clinical words; simple viewer never mixes series |
| `static.test.js` | every static script shipped outside the Vite build | must parse; every page must be copied into the image |

Property tests print their seed; replay a failure with `PROP_SEED=<seed> node --test properties.test.js`.

Not covered by tests, checked by hand: text burned into pixels (confirmation step before sharing), and the real
Orthanc anonymizer. For the latter, on the server:

```bash
python3 scripts/check_share_anon.py http://HOST/s/<token> "PATIENT NAME" <PatientID> <YYYYMMDD>
```
It scans the share's public JSON and every DICOM element of the downloaded copy for those identifiers.

## Security notes (Law 18-07 mindset)
- Data stays on your server; Orthanc has no published port and requires credentials.
- httpOnly session cookie, SameSite=Lax + mandatory `X-RadKit` header on writes (CSRF), bcrypt, login rate limit.
- Clinics never see private notes, tags, other clinics' studies or the radiologist's personal studies.
- Free-text descriptions kept for context are scrubbed of the patient's name, IDs and birth date (a description that
  contains them is rewritten, series descriptions that contain them are dropped).
- Shares point to a separate de-identified copy, built in the background by an Orthanc job (the link is returned at once; the colleague sees a waiting page until it is ready, and unfinished jobs resume after a restart); revoking deletes that copy and closes the image gate immediately.
- Anonymization removes DICOM tags but **cannot remove text burned into pixels** — hence the confirmation step.
- Everything sensitive is written to `audit_log`.

## Before production — check on your server
- Pin `orthancteam/orthanc` and `ohif/app` to tags you have tested (they are on `latest` here).
- The OHIF image is expected to serve on port 80 inside its container; if your tag uses another port, change `proxy_pass http://ohif:80` in `infra/nginx/default.conf.template`.
- Open one study in the viewer and confirm thumbnails and images load through `:8081/dicom-web/`.

## Known limitations
- Studies are identified by StudyInstanceUID: someone who uploads a file carrying the exact UIDs of a study already on the
  server gets that study attached to their workspace (images can no longer be overwritten: `OVERWRITE_INSTANCES=false`).
  Same UID normally means the same real exam (second opinion), so this is accepted for now.
- Files without the DICOM "DICM" preamble (some very old CDs) are rejected.
- A ZIP is unpacked in the browser's memory: very large archives (> ~1 GB) should be imported as a folder instead.

## Roadmap (not in v1)
- AI: prior-study comparison summary, French dictation (speech-to-text), PubMed lookup from DICOM tags.
- Auto-assign C-STORE arrivals by AE title to a radiologist.
- OCR check of burned-in text before sharing.
- PDF report with letterhead/logo, digital signature.
