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
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('The camera is still starting. Hold the card steady and try again.');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.86);
  }

  stop(video) {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    if (video) video.srcObject = null;
  }
}
