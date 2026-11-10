const treatments = new Set(["grid", "inlay", "glass", "radial", "weave", "facet"]);
const colors = ["background", "surface", "accent", "text", "muted", "border"];
const actionInk = "#101315";

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255);
  const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a, b) {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function parseCollectionVisual(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1
    || !treatments.has(value.treatment) || Object.keys(value).length !== colors.length + 2
    || colors.some(key => typeof value[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(value[key]))) return null;
  const { background, surface, text, muted, accent, border } = value;
  const readable = [background, surface].every(fill =>
    [text, muted, accent].every(ink => contrast(ink, fill) >= 4.5) && contrast(border, fill) >= 3);
  if (!readable || contrast(actionInk, accent) < 4.5 || luminance(surface) > 0.08 || luminance(background) > 0.08) return null;
  return value;
}

const artworkFormats = {
  backdrop: /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/,
  bezel: /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/,
};

export function parseCollectionArtwork(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 2) return null;
  const valid = Object.entries(artworkFormats).every(([part, format]) =>
    typeof value[part] === "string" && value[part].length <= 1_500_000 && format.test(value[part]));
  return valid ? value : null;
}

export function applyCollectionVisual(root, value, artwork) {
  const visual = parseCollectionVisual(value);
  const art = visual && parseCollectionArtwork(artwork);
  root.toggleAttribute("data-collection-artwork", Boolean(art));
  for (const part of Object.keys(artworkFormats)) {
    const property = `--collection-${part}-image`;
    if (art) root.style.setProperty(property, `url("${art[part]}")`);
    else root.style.removeProperty(property);
  }
  if (!visual) {
    delete root.dataset.collectionTreatment;
    for (const key of colors) root.style.removeProperty(`--collection-${key}`);
    root.style.removeProperty("--collection-action-ink");
    return false;
  }
  root.dataset.collectionTreatment = visual.treatment;
  for (const key of colors) root.style.setProperty(`--collection-${key}`, visual[key]);
  root.style.setProperty("--collection-action-ink", actionInk);
  return true;
}
