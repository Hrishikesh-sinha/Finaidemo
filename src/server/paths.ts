import path from 'node:path';

// The database. Named so it cannot be confused with finai.db, the unused
// legacy Python backend's file.
export const DB_FILE = path.join(process.cwd(), process.env.FINAI_DB_FILE || 'finai_data.sqlite');
// The old JSON store, imported into the database on first start.
export const LEGACY_JSON_FILE = path.join(process.cwd(), 'finai_store.json');
