// Test-only: an in-memory stand-in for the part of the Firestore Admin API
// that FirestoreRepo uses (doc get/create/set/update/delete, collection get
// and count, atomic batches). It follows Firestore's rules where they matter:
// create fails with ALREADY_EXISTS, update fails with NOT_FOUND, a batch is
// all-or-nothing, a batch holds at most 500 writes, data is copied in and out.

type Doc = Record<string, unknown>;
const fail = (code: number, msg: string) => Object.assign(new Error(`${code} ${msg}`), { code });
const clone = <T>(x: T): T => structuredClone(x);

function checkPath(p: string, wantDoc: boolean) {
  const parts = p.split('/');
  if (parts.some(s => s === '' || s === '.' || s === '..' || /^__.*__$/.test(s))) throw fail(3, `invalid path ${p}`);
  if ((parts.length % 2 === 0) !== wantDoc) throw fail(3, `${p} is not a ${wantDoc ? 'document' : 'collection'} path`);
}

export class FakeFirestore {
  readonly docs = new Map<string, Doc>();
  writes = 0;
  reads = 0;

  collection(path: string) { checkPath(path, false); return new FakeCollection(this, path); }
  batch() { return new FakeBatch(this); }
  async terminate() {}
  // Every document path under a collection path, for assertions.
  paths(prefix = '') { return [...this.docs.keys()].filter(k => k.startsWith(prefix)).sort(); }
}

class FakeDocRef {
  constructor(readonly fs: FakeFirestore, readonly path: string) { checkPath(path, true); }
  get id() { return this.path.split('/').pop()!; }
  async get() {
    this.fs.reads++;
    const d = this.fs.docs.get(this.path);
    return { id: this.id, ref: this, exists: d !== undefined, data: () => (d ? clone(d) : undefined) };
  }
  async create(data: Doc) { const b = this.fs.batch(); b.create(this, data); await b.commit(); }
  async set(data: Doc, opts?: { merge?: boolean }) { const b = this.fs.batch(); b.set(this, data, opts); await b.commit(); }
  async update(data: Doc) { const b = this.fs.batch(); b.update(this, data); await b.commit(); }
  async delete() { const b = this.fs.batch(); b.delete(this); await b.commit(); }
}

class FakeCollection {
  constructor(readonly fs: FakeFirestore, readonly path: string) {}
  doc(id: string) { return new FakeDocRef(this.fs, `${this.path}/${id}`); }
  private children() {
    const depth = this.path.split('/').length + 1;
    return [...this.fs.docs.entries()].filter(([k]) => k.startsWith(`${this.path}/`) && k.split('/').length === depth);
  }
  limit(_n: number) { return this; }
  async get() {
    const docs = this.children().map(([k, d]) => {
      this.fs.reads++;
      const ref = new FakeDocRef(this.fs, k);
      return { id: ref.id, ref, exists: true, data: () => clone(d) };
    });
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  count() { return { get: async () => ({ data: () => ({ count: this.children().length }) }) }; }
}

type Op = { kind: 'create' | 'set' | 'update' | 'delete'; ref: FakeDocRef; data?: Doc; merge?: boolean };

class FakeBatch {
  private ops: Op[] = [];
  constructor(readonly fs: FakeFirestore) {}
  create(ref: FakeDocRef, data: Doc) { this.ops.push({ kind: 'create', ref, data: clone(data) }); return this; }
  set(ref: FakeDocRef, data: Doc, opts?: { merge?: boolean }) { this.ops.push({ kind: 'set', ref, data: clone(data), merge: opts?.merge }); return this; }
  update(ref: FakeDocRef, data: Doc) { this.ops.push({ kind: 'update', ref, data: clone(data) }); return this; }
  delete(ref: FakeDocRef) { this.ops.push({ kind: 'delete', ref }); return this; }
  async commit() {
    if (this.ops.length > 500) throw fail(3, 'a batch may hold at most 500 writes');
    const next = new Map(this.fs.docs);
    for (const op of this.ops) {
      const cur = next.get(op.ref.path);
      if (op.kind === 'create') { if (cur) throw fail(6, `ALREADY_EXISTS ${op.ref.path}`); next.set(op.ref.path, op.data!); }
      else if (op.kind === 'set') next.set(op.ref.path, op.merge && cur ? { ...cur, ...op.data } : op.data!);
      else if (op.kind === 'update') { if (!cur) throw fail(5, `NOT_FOUND ${op.ref.path}`); next.set(op.ref.path, { ...cur, ...op.data }); }
      else next.delete(op.ref.path);
    }
    for (const [k] of this.fs.docs) if (!next.has(k)) this.fs.docs.delete(k);
    for (const [k, v] of next) this.fs.docs.set(k, v);
    this.fs.writes += this.ops.length;
  }
}
