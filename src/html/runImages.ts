// Screenshots attached to a failed step in run mode.
// Kept in IndexedDB rather than localStorage: a screenshot is far larger than the few bytes of a
// mark, and localStorage's few megabytes are shared by every local HTML file opened from disk.
// Where IndexedDB is unavailable the images simply last for the visit.

export interface StoredImage {
  id: string;
  /** `<namespace>:<case id>` of the case the image belongs to */
  caseKey: string;
  step: number;
  /** Fingerprint of the case's steps when the image was attached, so edited cases drop stale images */
  fingerprint: string;
  blob: Blob;
}

const DB_NAME = "test-sheet-run-images";
const STORE = "images";
/** Wider screenshots are scaled down: legible text needs about this much, and storage stays small */
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.85;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("caseKey", "caseKey");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function done<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function loadImages(caseKey: string, fingerprint: string): Promise<StoredImage[]> {
  const db = await openDb();
  if (!db) return [];
  const all = (await done(db.transaction(STORE).objectStore(STORE).index("caseKey").getAll(caseKey))) ?? [];
  const current = (all as StoredImage[]).filter((image) => image.fingerprint === fingerprint);
  const stale = (all as StoredImage[]).filter((image) => image.fingerprint !== fingerprint);
  for (const image of stale) await removeImage(image.id);
  return current;
}

export async function saveImage(image: StoredImage): Promise<void> {
  const db = await openDb();
  if (db) await done(db.transaction(STORE, "readwrite").objectStore(STORE).put(image));
}

export async function removeImage(id: string): Promise<void> {
  const db = await openDb();
  if (db) await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}

export async function removeCaseImages(caseKey: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const ids = (await done(db.transaction(STORE).objectStore(STORE).index("caseKey").getAllKeys(caseKey))) ?? [];
  for (const id of ids) await removeImage(String(id));
}

/** Scales a pasted image down and re-encodes it, keeping the original if that would not be smaller */
export async function shrinkImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    // JPEG has no alpha; a transparent screenshot would otherwise come out black
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return encoded && encoded.size < file.size ? encoded : file;
  } catch {
    return file;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

/**
 * The clipboard takes only PNG for an image on every browser, so a stored JPEG is redrawn as one.
 * Pasting that into an issue or comment box makes the site upload it and insert its own link.
 */
export async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return png ?? blob;
}
