import { describe, it, expect } from 'vitest';
import { deletePhotoFilesForShops, PHOTO_BUCKET } from './shop-photos';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Fake photo rows and a fake bucket, recording every delete. */
function world(seed: { rows?: Array<{ retailer_id: string; storage_path: string | null }>; files?: string[] } = {}, opts: {
  rowsError?: any; listError?: any; removeError?: (paths: string[]) => string | null; deleteRowsError?: string; listPage?: number;
} = {}) {
  const state = { rows: [...(seed.rows || [])], files: new Set(seed.files || []), removeCalls: [] as string[][], listCalls: [] as string[], buckets: [] as string[] };
  const db = {
    from(table: string) {
      if (table !== 'shop_photos') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: async (_c: string, id: string) => opts.rowsError ? { data: null, error: opts.rowsError } : { data: state.rows.filter((r) => r.retailer_id === id), error: null } }),
        delete: () => ({ eq: async (_c: string, id: string) => { if (opts.deleteRowsError) return { error: { message: opts.deleteRowsError } }; state.rows = state.rows.filter((r) => r.retailer_id !== id); return { error: null }; } }),
      };
    },
  };
  const storage = {
    from(bucket: string) {
      state.buckets.push(bucket);
      return {
        list: async (path: string) => {
          state.listCalls.push(path);
          if (opts.listError) return { data: null, error: opts.listError };
          const names = Array.from(state.files).filter((f) => f.startsWith(`${path}/`)).map((f) => ({ name: f.slice(path.length + 1) }));
          return { data: opts.listPage ? names.slice(0, opts.listPage) : names, error: null };
        },
        remove: async (paths: string[]) => {
          state.removeCalls.push(paths);
          const err = opts.removeError?.(paths);
          if (err) return { data: null, error: { message: err } };
          for (const p of paths) state.files.delete(p);
          return { data: [], error: null };
        },
      };
    },
  };
  return { db, storage, state };
}

describe('deletePhotoFilesForShops', () => {
  it('deletes every file for the shop from storage and reports it clear', async () => {
    const w = world({ rows: [{ retailer_id: A, storage_path: `${A}/one.jpg` }, { retailer_id: A, storage_path: `${A}/two.png` }], files: [`${A}/one.jpg`, `${A}/two.png`] });
    const r = await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(r).toEqual({ cleared: [A], failed: [], filesRemoved: 2 });
    expect(w.state.files.size).toBe(0);
    expect(new Set(w.state.buckets)).toEqual(new Set([PHOTO_BUCKET]));
  });

  it('never touches another shop\'s files', async () => {
    const w = world({ rows: [{ retailer_id: A, storage_path: `${A}/one.jpg` }, { retailer_id: B, storage_path: `${B}/keep.jpg` }], files: [`${A}/one.jpg`, `${B}/keep.jpg`] });
    await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(Array.from(w.state.files)).toEqual([`${B}/keep.jpg`]);
    expect(w.state.listCalls).toEqual([A]);
  });

  it('finds a file whose record was lost, by listing the shop\'s folder', async () => {
    const w = world({ rows: [], files: [`${A}/orphan.jpg`] });
    const r = await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(r).toMatchObject({ cleared: [A], filesRemoved: 1 });
    expect(w.state.files.size).toBe(0);
  });

  it('ignores a record that points outside the shop\'s own folder, whatever it says', async () => {
    const w = world({ rows: [{ retailer_id: A, storage_path: `${B}/not-yours.jpg` }, { retailer_id: A, storage_path: `${A}/../${B}/sneaky.jpg` }, { retailer_id: A, storage_path: null }], files: [`${B}/not-yours.jpg`] });
    const r = await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(r).toMatchObject({ cleared: [A], filesRemoved: 0 });
    expect(Array.from(w.state.files)).toEqual([`${B}/not-yours.jpg`]);
    expect(w.state.removeCalls).toEqual([]);
  });

  it('refuses an id that is not a shop id, so an empty id can never mean "the whole bucket"', async () => {
    const w = world({ files: [`${A}/one.jpg`] });
    const r = await deletePhotoFilesForShops(w.db, w.storage, ['', '..', 'not-a-uuid', `${A}/x`]);
    expect(r.cleared).toEqual([]);
    expect(r.failed).toHaveLength(4);
    expect(w.state.listCalls).toEqual([]);
    expect(w.state.removeCalls).toEqual([]);
    expect(w.state.files.size).toBe(1);
  });

  it('a shop with no photos is clear, with nothing deleted', async () => {
    const w = world();
    expect(await deletePhotoFilesForShops(w.db, w.storage, [A])).toEqual({ cleared: [A], failed: [], filesRemoved: 0 });
    expect(w.state.removeCalls).toEqual([]);
  });

  it('if the files cannot be deleted, the shop is NOT clear, so its record is kept', async () => {
    const w = world({ rows: [{ retailer_id: A, storage_path: `${A}/one.jpg` }], files: [`${A}/one.jpg`] }, { removeError: () => 'storage is down' });
    const r = await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(r.cleared).toEqual([]);
    expect(r.failed).toEqual([{ id: A, reason: 'could not delete files: storage is down' }]);
  });

  it('if the records or the folder cannot be read, that is a failure, not "no photos"', async () => {
    const one = world({ files: [`${A}/one.jpg`] }, { rowsError: { message: 'connection reset' } });
    expect((await deletePhotoFilesForShops(one.db, one.storage, [A])).cleared).toEqual([]);
    const two = world({ files: [`${A}/one.jpg`] }, { listError: { message: 'timeout' } });
    expect((await deletePhotoFilesForShops(two.db, two.storage, [A])).cleared).toEqual([]);
    expect(one.state.files.size + two.state.files.size).toBe(2);
  });

  it('where photos were never set up (no table, no bucket) there is nothing to delete and the shop is clear', async () => {
    const w = world({}, { rowsError: { code: '42P01', message: 'relation "public.shop_photos" does not exist' }, listError: { message: 'Bucket not found' } });
    expect(await deletePhotoFilesForShops(w.db, w.storage, [A])).toEqual({ cleared: [A], failed: [], filesRemoved: 0 });
  });

  it('one shop failing does not stop the others', async () => {
    const w = world({ files: [`${A}/one.jpg`, `${B}/two.jpg`] }, { removeError: (paths) => (paths[0].startsWith(A) ? 'nope' : null) });
    const r = await deletePhotoFilesForShops(w.db, w.storage, [A, B, B]);
    expect(r.cleared).toEqual([B]);
    expect(r.failed.map((f) => f.id)).toEqual([A]);
    expect(Array.from(w.state.files)).toEqual([`${A}/one.jpg`]);
  });

  it('deletes in batches, and a shop with more files than one pass can list is retried rather than called clear', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `${A}/f${i}.jpg`);
    const w = world({ files: many });
    const r = await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(r).toMatchObject({ cleared: [A], filesRemoved: 250 });
    expect(w.state.removeCalls.map((c) => c.length)).toEqual([100, 100, 50]);

    const big = world({ files: Array.from({ length: 1000 }, (_, i) => `${A}/f${i}.jpg`) });
    const r2 = await deletePhotoFilesForShops(big.db, big.storage, [A]);
    expect(r2.filesRemoved).toBe(1000);
    expect(r2.cleared).toEqual([]);
    expect(r2.failed[0].reason).toMatch(/run again/);
  });

  it('with alsoDeleteRecords, the photo records go too, but only after the files have', async () => {
    const w = world({ rows: [{ retailer_id: A, storage_path: `${A}/one.jpg` }, { retailer_id: B, storage_path: `${B}/keep.jpg` }], files: [`${A}/one.jpg`, `${B}/keep.jpg`] });
    expect(await deletePhotoFilesForShops(w.db, w.storage, [A], { alsoDeleteRecords: true })).toMatchObject({ cleared: [A], filesRemoved: 1 });
    expect(w.state.rows).toEqual([{ retailer_id: B, storage_path: `${B}/keep.jpg` }]);

    const stuck = world({ rows: [{ retailer_id: A, storage_path: `${A}/one.jpg` }], files: [`${A}/one.jpg`] }, { removeError: () => 'down' });
    await deletePhotoFilesForShops(stuck.db, stuck.storage, [A], { alsoDeleteRecords: true });
    expect(stuck.state.rows).toHaveLength(1); // records kept, so the files can still be found
  });

  it('without alsoDeleteRecords, records are left for the database to cascade', async () => {
    const w = world({ rows: [{ retailer_id: A, storage_path: `${A}/one.jpg` }], files: [`${A}/one.jpg`] });
    await deletePhotoFilesForShops(w.db, w.storage, [A]);
    expect(w.state.rows).toHaveLength(1);
  });

  it('works while SHOP_PHOTOS is off: files from when it was on must still be deletable', async () => {
    delete process.env.SHOP_PHOTOS;
    const w = world({ files: [`${A}/one.jpg`] });
    expect((await deletePhotoFilesForShops(w.db, w.storage, [A])).filesRemoved).toBe(1);
  });
});
