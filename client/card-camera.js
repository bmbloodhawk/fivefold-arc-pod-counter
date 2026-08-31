export class CardCameraSession {
  constructor(mediaDevices = globalThis.navigator?.mediaDevices) {
    this.mediaDevices = mediaDevices;
    this.stream = null;
  }

  async start(video) {
    if (!this.mediaDevices?.getUserMedia) throw new Error('This browser cannot open a camera. Type the card name instead.');
    this.stop(video);
    this.stream = await this.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = this.stream;
    await video.play?.();
  }

  capture(video, canvas) {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('The camera is still starting. Hold the card steady and try again.');
    const aspect = 5 / 7;
    let cropWidth = sourceWidth;
    let cropHeight = cropWidth / aspect;
    if (cropHeight > sourceHeight) { cropHeight = sourceHeight; cropWidth = cropHeight * aspect; }
    const sourceX = (sourceWidth - cropWidth) / 2;
    const sourceY = (sourceHeight - cropHeight) / 2;
    // TCGTracking accepts at most 100 KB decoded. This is deliberately above
    // Scryfall's small-card resolution but leaves headroom for a detailed foil.
    canvas.width = 240;
    canvas.height = 336;
    const context = canvas.getContext('2d');
    context.drawImage(video, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  async readText(canvas) {
    if (typeof globalThis.TextDetector !== 'function') {
      throw new Error('This browser cannot read card text locally. Type the title below instead.');
    }
    const blocks = await new globalThis.TextDetector().detect(canvas);
    return blocks.map(block => String(block.rawValue || '').trim()).filter(Boolean);
  }

  stop(video) {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (video) video.srcObject = null;
  }
}
