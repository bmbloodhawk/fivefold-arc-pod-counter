const KEY = "fivefold-arc:table-device:v1";
const DEVICE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function getTableDeviceId() {
  try {
    const storage = globalThis.localStorage;
    const stored = storage.getItem(KEY);
    if (DEVICE_ID.test(stored)) return stored.toLowerCase();
    const id = globalThis.crypto.randomUUID();
    storage.setItem(KEY, id);
    return id;
  } catch {
    return null;
  }
}
