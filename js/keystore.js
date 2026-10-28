// What must stay on this device and out of any copy: the key of the encrypted copy (IndexedDB can keep it without it being readable).
const DB = 'cuaderno-gastos', STORE = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

export const getKey = (name) => run('readonly', (s) => s.get(name)).catch(() => null);
export const putKey = (name, value) => run('readwrite', (s) => s.put(value, name));
export const delKey = (name) => run('readwrite', (s) => s.delete(name)).catch(() => {});
