import express from 'express';
import { pathToFileURL } from 'node:url';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { migrate, one, q } from './db.js';
import { loadUser, csrfGuard } from './lib/auth.js';
import { HttpError } from './lib/http.js';
import { aiEnabled } from './lib/ai.js';
import { orthanc } from './lib/orthanc.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import uploadRoutes from './routes/upload.js';
import studyRoutes from './routes/studies.js';
import patientRoutes from './routes/patients.js';
import reportRoutes from './routes/reports.js';
import shareRoutes from './routes/shares.js';
import internalRoutes from './routes/internal.js';
import aiRoutes from './routes/ai.js';
import liteRoutes from './routes/lite.js';
import { resumePending } from './lib/shareJobs.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());

  const api = express.Router();
  // DICOMweb gate is called by nginx without CSRF header / JSON body
  api.use(internalRoutes);
  api.use(express.json({ limit: '1mb' }));
  api.use(loadUser);
  api.use(csrfGuard);

  api.get('/health', async (_req, res) => {
    let dicom = 'ok';
    try {
      await orthanc.system();
    } catch {
      dicom = 'down';
    }
    res.json({ ok: true, dicom });
  });
  api.get('/config', (_req, res) => res.json({ aiEnabled: aiEnabled() }));

  api.use('/auth', authRoutes);
  api.use(userRoutes);
  api.use(uploadRoutes);
  api.use(studyRoutes);
  api.use(patientRoutes);
  api.use(reportRoutes);
  api.use(shareRoutes);
  api.use(aiRoutes);
  api.use(liteRoutes);
  api.use((_req, _res, next) => next(new HttpError(404, 'Route inconnue')));

  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Fichier trop volumineux');
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON invalide');
    const status = err.status || 500;
    if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(status).json({
      error: status >= 500 && !(err instanceof HttpError) ? 'Erreur serveur' : err.message,
      ...(err.extra || {}),
    });
  });
  return app;
}

async function ensureAdmin() {
  const n = await one('SELECT count(*)::int AS n FROM users');
  if (n.n > 0) return;
  if (!config.admin.email || !config.admin.password) {
    console.warn('No users and no ADMIN_EMAIL/ADMIN_PASSWORD set: cannot create the first admin.');
    return;
  }
  await q(
    `INSERT INTO users (email, password_hash, full_name, role, must_change_password)
     VALUES ($1,$2,'Administrateur','admin',true)`,
    [config.admin.email.toLowerCase(), await bcrypt.hash(config.admin.password, 12)]
  );
  console.log(`Admin account created: ${config.admin.email}`);
}

async function cleanup() {
  // Abandoned uploads (never finalized) older than a day
  await q("DELETE FROM pending_uploads WHERE created_at < now() - interval '1 day'").catch(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (let i = 1; ; i++) {
    try {
      await migrate();
      break;
    } catch (e) {
      if (i >= 30) throw e;
      console.log(`Database not ready (${e.message}), retrying…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await ensureAdmin();
  resumePending().catch((e) => console.error('resume shares', e.message));
  setInterval(cleanup, 3600e3).unref();
  createApp().listen(config.port, config.host, () => console.log(`RadKit API on :${config.port}`));
}
