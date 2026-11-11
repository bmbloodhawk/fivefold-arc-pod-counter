const limit = (env, key, fallback) => {
  if (env[key] === undefined) return fallback;
  const raw = String(env[key]).trim(), value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > 1024) {
    throw new Error(`${key} must be an integer from 1 to 1024.`);
  }
  return value;
};

// Defaults preserve the existing release. Higher budgets are opt-in per service.
export function liveStreamLimitsFromEnv(env = process.env) {
  const maxStreamsPerIp = limit(env, 'MAX_LIVE_STREAMS_PER_IP', 32);
  const maxStreamsGlobal = limit(env, 'MAX_LIVE_STREAMS_GLOBAL', 64);
  if (maxStreamsPerIp > maxStreamsGlobal) throw new Error('MAX_LIVE_STREAMS_GLOBAL must be at least MAX_LIVE_STREAMS_PER_IP.');
  return { maxStreamsPerIp, maxStreamsGlobal };
}
