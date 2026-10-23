export function podCodeFromQr(value) {
  const raw = String(value || '').trim();
  if (/^[A-Z0-9]{6}$/i.test(raw)) return raw.toUpperCase();
  try {
    const code = new URL(raw).searchParams.get('join') || '';
    return /^[A-Z0-9]{6}$/i.test(code) ? code.toUpperCase() : null;
  } catch { return null; }
}

function canRetryWithGenericCamera(error) {
  return ['TypeError', 'OverconstrainedError'].includes(error?.name) || /illegal invocation/i.test(String(error?.message || ''));
}

async function readImagePixels(file) {
  if (!(file instanceof Blob)) throw new Error('Choose a photo from your phone camera.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('That photo could not be read. Try taking it again.'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// The decoder runs entirely on the current video frame. Nothing from the
// camera is uploaded or retained after a matching pod code is found.
export class JoinQrScanner {
  constructor({ mediaDevices = globalThis.navigator?.mediaDevices, decoder = globalThis.jsQR, requestFrame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame, imageReader = readImagePixels } = {}) {
    this.mediaDevices = mediaDevices;
    this.decoder = decoder;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.imageReader = imageReader;
    this.stream = null;
    this.frame = null;
    this.canvas = null;
  }

  async start(video, onCode) {
    if (!this.mediaDevices?.getUserMedia) throw new Error('This browser cannot open the camera. Enter the six-character pod code instead.');
    if (typeof this.decoder !== 'function') throw new Error('QR scanning is not available here. Enter the six-character pod code instead.');
    this.stop(video);
    try {
      this.stream = await this.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    } catch (error) {
      // Some current Android browser builds reject a facing-mode constraint
      // before opening the camera. Retrying without it still lets the player
      // select a camera in the browser's normal way.
      if (!canRetryWithGenericCamera(error)) throw error;
      this.stream = await this.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    // iOS Safari treats these as video-element properties, not just markup
    // attributes, when a camera stream is attached after opening a dialog.
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    try {
      await video.play?.();
    } catch (error) {
      this.stop(video);
      throw error;
    }
    const scan = () => {
      if (!this.stream) return;
      if (video.videoWidth && video.videoHeight) {
        this.canvas ||= document.createElement('canvas');
        this.canvas.width = video.videoWidth;
        this.canvas.height = video.videoHeight;
        try {
          const context = this.canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
          const result = this.decoder(context.getImageData(0, 0, this.canvas.width, this.canvas.height).data, this.canvas.width, this.canvas.height, { inversionAttempts: 'dontInvert' });
          const code = podCodeFromQr(result?.data);
          if (code) { onCode(code); return; }
        } catch {
          // A partially-ready video frame can be unreadable; try the next one.
        }
      }
      this.frame = this.requestFrame(scan);
    };
    this.frame = this.requestFrame(scan);
  }

  async scanImageFile(file) {
    if (typeof this.decoder !== 'function') throw new Error('QR scanning is not available here. Enter the six-character pod code instead.');
    const { data, width, height } = await this.imageReader(file);
    return podCodeFromQr(this.decoder(data, width, height, { inversionAttempts: 'attemptBoth' })?.data);
  }

  stop(video) {
    if (this.frame !== null) this.cancelFrame?.(this.frame);
    this.frame = null;
    this.stream?.getTracks?.().forEach(track => track.stop());
    this.stream = null;
    if (video) video.srcObject = null;
  }
}
