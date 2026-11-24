export const isHexColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function contrastRatio(first, second) {
  if (!isHexColor(first) || !isHexColor(second)) return null;
  const luminance = hex => hex.slice(1).match(/../g).reduce((sum, pair, index) => {
    const value = parseInt(pair, 16) / 255;
    const linear = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][index];
  }, 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
}
