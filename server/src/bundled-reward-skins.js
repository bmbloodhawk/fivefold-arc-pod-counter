import { readFile } from "node:fs/promises";
import { resolveDesignArtwork } from "../../client/appearance-design-artwork.js";
import {
  assertAppearanceValid, publicAppearanceSkin, validateAppearanceAsset, validateAppearanceSkin,
} from "../../client/appearance-validation.js";
import { FIELD_NOTES_SKIN_ID, NIGHT_WATCH_SKIN_ID, PRISMATIC_CONFLUENCE_SKIN_ID } from "./appearance-milestones.js";

async function loadBundledSkin(directory, id, name) {
  const { skin, assets } = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  if (skin.id !== id || skin.status !== "Approved") {
    throw new Error(name + " must be the approved reward design.");
  }
  const artwork = await Promise.all(assets.map(async ({ file, ...metadata }) => {
    if (!/^[a-z0-9-]+\.webp$/.test(file) || metadata.status !== "Approved") {
      throw new Error(name + " requires approved, bundled WebP artwork.");
    }
    const bytes = await readFile(new URL(file, directory));
    const asset = { ...metadata, data: "data:image/webp;base64," + bytes.toString("base64") };
    assertAppearanceValid(validateAppearanceAsset(asset, { requireData: true }));
    return asset;
  }));
  assertAppearanceValid(validateAppearanceSkin(skin, { assets: artwork, requireApprovedAssets: true, publish: true }));
  // Keep the reviewed files independent of the editable catalog. The earned
  // skin routes release this renderer payload after account or table approval.
  const byId = new Map(artwork.map(asset => [asset.id, asset.data]));
  const symbols = Object.entries(skin.symbolAssets || {}).filter(([, assetId]) => byId.has(assetId));
  return {
    ...publicAppearanceSkin(skin),
    ...(symbols.length ? { symbolData: Object.fromEntries(symbols.map(([mode, assetId]) => [mode, byId.get(assetId)])) } : {}),
    backgroundData: byId.get(skin.backgroundAsset),
    ...resolveDesignArtwork(skin, id => byId.get(id)),
  };
}

export function loadFieldNotesSkin() {
  return loadBundledSkin(new URL("../static-data/field-notes/", import.meta.url), FIELD_NOTES_SKIN_ID, "Field Notes");
}

export function loadNightWatchSkin() {
  return loadBundledSkin(new URL("../static-data/night-watch/", import.meta.url), NIGHT_WATCH_SKIN_ID, "Night Watch");
}

export function loadPrismaticConfluenceSkin() {
  return loadBundledSkin(new URL("../static-data/prismatic-confluence/", import.meta.url), PRISMATIC_CONFLUENCE_SKIN_ID, "Prismatic Confluence");
}
