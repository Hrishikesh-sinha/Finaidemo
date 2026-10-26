// node:sqlite is marked experimental in Node 22 and prints a warning when it
// loads. Drop exactly that warning (nothing else) so the console stays clean.
// Imported first in every entry point, before anything loads node:sqlite.
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (typeof text === 'string' && text.includes('SQLite is an experimental feature')) return;
  return (original as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
export {};
