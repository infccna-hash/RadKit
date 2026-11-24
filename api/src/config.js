const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(env.PORT || 4000),
  host: env.HOST || '0.0.0.0',
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  shareSecret: env.SHARE_SECRET || required('JWT_SECRET'),
  cookieSecure: env.COOKIE_SECURE === 'true',
  publicAppUrl: (env.PUBLIC_APP_URL || '').replace(/\/$/, ''),
  publicViewerUrl: (env.PUBLIC_VIEWER_URL || '').replace(/\/$/, ''),
  orthanc: {
    url: (env.ORTHANC_URL || 'http://localhost:8042').replace(/\/$/, ''),
    user: env.ORTHANC_USER || '',
    password: env.ORTHANC_PASSWORD || '',
  },
  admin: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
  ai: {
    apiKey: env.DEEPSEEK_API_KEY || '',
    baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model: env.DEEPSEEK_MODEL || 'deepseek-flash',
  },
  sessionHours: Number(env.SESSION_HOURS || 12),
  shareDefaultDays: Number(env.SHARE_DEFAULT_DAYS || 7),
};
