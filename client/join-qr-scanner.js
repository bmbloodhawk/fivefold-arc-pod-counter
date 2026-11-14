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

const MAX_PHOTO_EDGE = 2048;

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
    const { naturalWidth, naturalHeight } = image;
    if (!naturalWidth || !naturalHeight) throw new Error('That photo could not be read. Try taking it again.');
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(naturalWidth, naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('That photo could not be read. Try taking it again.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// The decoder runs entirely on the current video frame. Nothing from the
// camera is uploaded or retained after a matching QR value is found.
export class JoinQrScanner {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    decoder = globalThis.jsQR,
    requestFrame = callback => globalThis.requestAnimationFrame(callback),
    cancelFrame = frame => globalThis.cancelAnimationFrame(frame),
    imageReader = readImagePixels,
    parseCode = podCodeFromQr,
    fallbackText = 'Enter the six-character pod code instead.',
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.decoder = decoder;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.imageReader = imageReader;
    this.parseCode = parseCode;
    this.fallbackText = fallbackText;
    this.stream = null;
    this.frame = null;
    this.canvas = null;
    this.generation = 0;
    this.release = null;
  }

  async start(video, onCode) {
    this.stop(video);
    if (!this.mediaDevices?.getUserMedia) throw new Error(`This browser cannot open the camera. ${this.fallbackText}`);
    if (typeof this.decoder !== 'function') throw new Error(`QR scanning is not available here. ${this.fallbackText}`);
    const generation = this.generation;
    const current = () => generation === this.generation;
    let stream, released = false;
    const release = () => {
      if (!stream || released) return;
      released = true;
      stream.getTracks?.().forEach(track => track.stop());
      if (video.srcObject === stream) video.srcObject = null;
      if (this.stream === stream) this.stream = null;
    };
    this.release = release;
    try {
      try {
        stream = await this.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      } catch (error) {
        // Retry unsupported facing-mode constraints only while this scan is open.
        if (!current()) return;
        if (!canRetryWithGenericCamera(error)) throw error;
        stream = await this.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      if (!current()) { release(); return; }
      this.stream = stream;
      // iOS Safari requires these properties when a camera opens in a dialog.
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play?.();
      if (!current()) { release(); return; }
    } catch (error) {
      release();
      if (!current()) return;
      this.stop(video);
      throw error;
    }
    const scan = () => {
      if (!current() || this.stream !== stream) return;
      this.frame = null;
      if (video.videoWidth && video.videoHeight) {
        this.canvas ||= document.createElement('canvas');
        this.canvas.width = video.videoWidth;
        this.canvas.height = video.videoHeight;
        try {
          const context = this.canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
          const result = this.decoder(context.getImageData(0, 0, this.canvas.width, this.canvas.height).data, this.canvas.width, this.canvas.height, { inversionAttempts: 'dontInvert' });
          const code = this.parseCode(result?.data);
          if (code) { this.stop(video); onCode(code); return; }
        } catch {
          // A partially-ready video frame can be unreadable; try the next one.
        }
      }
      if (current()) this.frame = this.requestFrame(scan);
    };
    this.frame = this.requestFrame(scan);
  }

  async scanImageFile(file) {
    if (typeof this.decoder !== 'function') throw new Error(`QR scanning is not available here. ${this.fallbackText}`);
    const generation = this.generation;
    const { data, width, height } = await this.imageReader(file);
    if (generation !== this.generation) return null;
    return this.parseCode(this.decoder(data, width, height, { inversionAttempts: 'attemptBoth' })?.data);
  }

  stop(_video) {
    this.generation++;
    if (this.frame !== null) this.cancelFrame?.(this.frame);
    this.frame = null;
    // Each release closure owns its stream and video. Late completion from an
    // older start cannot detach or stop a newer camera session.
    this.release?.();
    this.release = null;
  }
}
