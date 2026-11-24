-- RadKit schema (idempotent: safe to run on every start)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','radiologist','client')),
  organization  TEXT,                       -- clinic / cabinet name
  phone         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- A client (clinic) works with one or more radiologists
CREATE TABLE IF NOT EXISTS client_links (
  client_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  radiologist_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, radiologist_id)
);

-- Patients live in a radiologist's workspace
CREATE TABLE IF NOT EXISTS patients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  name_key    TEXT NOT NULL,                -- phonetic key for matching
  birth_date  DATE,
  sex         TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_owner_idx ON patients(owner_id, status);

-- Every (PatientID, issuer) combination seen in DICOM for this patient
CREATE TABLE IF NOT EXISTS patient_identifiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dicom_patient_id TEXT NOT NULL,
  issuer          TEXT NOT NULL DEFAULT '',  -- institution name / issuer of ID
  dicom_name      TEXT,
  UNIQUE (owner_id, dicom_patient_id, issuer)
);

CREATE TABLE IF NOT EXISTS studies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- radiologist
  client_id      UUID REFERENCES users(id) ON DELETE SET NULL,          -- clinic that sent it
  uploaded_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  patient_id     UUID REFERENCES patients(id) ON DELETE SET NULL,
  orthanc_id     TEXT NOT NULL,
  study_uid      TEXT NOT NULL,
  accession      TEXT,
  study_date     DATE,
  description    TEXT,
  modalities     TEXT[] NOT NULL DEFAULT '{}',
  body_part      TEXT,
  institution    TEXT,
  referring      TEXT,
  series_count   INT NOT NULL DEFAULT 0,
  instance_count INT NOT NULL DEFAULT 0,
  dicom_patient_name TEXT,
  dicom_patient_id   TEXT,
  dicom_birth_date   DATE,
  dicom_sex          TEXT,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','reported')),
  priority       TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','normal','low')),
  clinical_info  TEXT,                       -- indication sent by the clinic
  private_note   TEXT,                       -- radiologist only
  tags           TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_at    TIMESTAMPTZ,
  UNIQUE (owner_id, study_uid)
);
CREATE INDEX IF NOT EXISTS studies_owner_idx ON studies(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS studies_client_idx ON studies(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS studies_uid_idx ON studies(study_uid);
CREATE INDEX IF NOT EXISTS studies_patient_idx ON studies(patient_id);

-- Orthanc studies a user pushed instances into, awaiting finalize
CREATE TABLE IF NOT EXISTS pending_uploads (
  orthanc_study_id TEXT NOT NULL,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (orthanc_study_id, user_id)
);

CREATE TABLE IF NOT EXISTS merge_suggestions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_a  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  patient_b  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  score      REAL NOT NULL,
  reasons    TEXT[] NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patient_a, patient_b)
);

CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id     UUID NOT NULL UNIQUE REFERENCES studies(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES users(id),
  title        TEXT,
  indication   TEXT,
  technique    TEXT,
  findings     TEXT,
  conclusion   TEXT,
  patient_summary TEXT,                     -- plain-language version (optional)
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final')),
  finalized_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id        UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  anon_orthanc_id TEXT NOT NULL,
  anon_study_uid  TEXT NOT NULL,
  anon_patient_id TEXT NOT NULL,
  recipient       TEXT,                      -- free text: "Dr X, CHU Batna"
  message         TEXT,                      -- question for the colleague
  include_report  BOOLEAN NOT NULL DEFAULT false,
  burned_in_risk  BOOLEAN NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_uid_idx ON shares(anon_study_uid);

CREATE TABLE IF NOT EXISTS share_replies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id   UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID,
  action    TEXT NOT NULL,
  target    TEXT,
  detail    JSONB,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at DESC);

-- v1.2: anonymized copies are prepared in the background
ALTER TABLE shares ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE shares ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE shares ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMPTZ;
ALTER TABLE shares ALTER COLUMN anon_orthanc_id DROP NOT NULL;
ALTER TABLE shares ALTER COLUMN anon_study_uid DROP NOT NULL;
