import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const url = 'http://127.0.0.1:8797/review';
const store = join(process.env.LOCALAPPDATA, 'Fivefold Arc', 'Appearance Studio', 'premium-skins.json');
async function ready() {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1200) });
    return (
      response.ok &&
      response.headers.get('x-studio-fixture') === 'file' &&
      response.headers.get('x-studio-premium') === '1'
    );
  } catch {
    return false;
  }
}
if (!(await ready())) {
  const runner = spawn(
    process.execPath,
    [fileURLToPath(new URL('./appearance-studio-local.mjs', import.meta.url)), '8797'],
    {
      env: { ...process.env, STUDIO_REVIEW_STORE: store },
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    }
  );
  runner.unref();
  let started = false;
  for (let n = 0; n < 30; n++) {
    await delay(250);
    if (await ready()) {
      started = true;
      break;
    }
  }
  if (!started)
    throw new Error(
      'The desktop Studio could not start. Check the local catalog or whether port 8797 is in use.'
    );
}
spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
}).unref();
