// FinAI server entry point: opens the SQLite database (importing the old JSON
// store on first start), mounts the API (src/server/app.ts) and the frontend.
//
// Environment (server-side only, never shipped to the browser):
//   AUTH_SECRET     >= 32 chars, signs session tokens. If unset, a random
//                   per-process secret is used and sessions end on restart.
//   GEMINI_API_KEY  optional; without it, AI text uses built-in templates.
//   ML_SERVICE_URL  forecasting service, default http://localhost:8000.
//   FIREBASE_SERVICE_ACCOUNT  service-account JSON. When set, every record is
//                   stored in Firebase Firestore and nothing on disk. Unset,
//                   a local SQLite file is used (development only).

import './src/server/quietSqliteWarning';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { createApp, ML_FORECAST_HORIZON_WEEKS, type MlForecast } from './src/server/app';
import { resolveAuthSecret } from './src/server/auth';
import { makeGeminiGenerator } from './src/server/gemini';
import { openStore } from './src/server/bootstrap';
import { firestoreFromEnv } from './src/server/firestoreRepo';
import { DB_FILE, LEGACY_JSON_FILE } from './src/server/paths';

// .env.local first (what RUNNING_LOCALLY.md tells you to create), then .env.
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_FORECAST_TIMEOUT_MS = 5000;

process.on('uncaughtException', (err: Error) => {
  console.error('[FinAI System] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FinAI System] Unhandled rejection:', reason instanceof Error ? reason.message : 'unknown reason');
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Ask the forecasting service for a forecast. Returns null on any failure so
// the caller can fall back and label it honestly.
async function fetchMlForecast(weekly: number[]): Promise<MlForecast | null> {
  try {
    const res = await fetch(`${ML_SERVICE_URL}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: weekly, horizon: ML_FORECAST_HORIZON_WEEKS }),
      signal: AbortSignal.timeout(ML_FORECAST_TIMEOUT_MS)
    });
    if (!res.ok) {
      console.warn(`[FinAI] Forecast service returned HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as MlForecast;
    const usable =
      Array.isArray(data?.forecast) &&
      data.forecast.length > 0 &&
      data.forecast.every(n => typeof n === 'number' && Number.isFinite(n));
    if (!usable) {
      console.warn('[FinAI] Forecast service returned an unusable payload');
      return null;
    }
    if (typeof data.model !== 'string' || data.model.length === 0) {
      console.warn('[FinAI] Forecast service did not report a model');
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`[FinAI] Forecast service unavailable at ${ML_SERVICE_URL}: ${err instanceof Error ? err.message : 'unknown error'}`);
    return null;
  }
}

async function startServer() {
  const { secret, ephemeral } = resolveAuthSecret();
  if (ephemeral) {
    console.warn('[FinAI] AUTH_SECRET is not set: using a random key for this run. Everyone is signed out when the server restarts.');
  }

  const firestore = await firestoreFromEnv();
  if (!firestore) {
    console.warn(`[FinAI] FIREBASE_SERVICE_ACCOUNT is not set: storing data in the local file ${path.basename(DB_FILE)}${process.env.NODE_ENV === 'production' ? '. On a host that wipes its disk (Render free tier) this data is lost on every restart' : ''}.`);
  }
  const repo = await openStore({ dbFile: DB_FILE, legacyJsonFile: LEGACY_JSON_FILE, demoPassword: process.env.DEMO_PASSWORD, firestore });
  const app = createApp({
    repo,
    authSecret: secret,
    fetchForecast: fetchMlForecast,
    mlStatus: async () => {
      try {
        const res = await fetch(`${ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return 'unreachable';
        const state = ((await res.json()) as { chronos_state?: string }).chronos_state;
        return state === 'ready' || state === 'loading' || state === 'failed' ? state : 'unreachable';
      } catch {
        return 'unreachable';
      }
    },
    generate: makeGeminiGenerator(process.env.GEMINI_API_KEY)
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
    } else {
      console.warn(`[FinAI] dist directory not found at ${distPath}.`);
      app.get('*', (_req, res) => res.status(503).send('FinAI frontend has not been built. Run `npm run build`.'));
    }
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`FinAI server listening on http://${HOST}:${PORT} (PORT=${PORT})`);
  });
  server.on('error', (err: Error) => console.error('[FinAI] Server listen error on port', PORT, err.message));
}

startServer().catch(fatalErr => {
  console.error('[FinAI] Fatal startup error:', fatalErr instanceof Error ? fatalErr.message : fatalErr);
  process.exit(1);
});
