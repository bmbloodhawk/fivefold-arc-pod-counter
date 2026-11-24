import { readFile } from "node:fs/promises";
import { resolveDesignArtwork } from "../../client/appearance-design-artwork.js";
import {
  assertAppearanceValid, publicAppearanceSkin, validateAppearanceAsset, validateAppearanceSkin,
} from "../../client/appearance-validation.js";
import { NIGHT_WATCH_SKIN_ID } from "./appearance-milestones.js";

const directory = new URL("../static-data/night-watch/", import.meta.url);

export async function loadNightWatchSkin() {
  const { skin, assets } = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  if (skin.id !== NIGHT_WATCH_SKIN_ID || skin.status !== "Approved") {
    throw new Error("Night Watch must be the approved reward design.");
  }
  const artwork = await Promise.all(assets.map(async ({ file, ...metadata }) => {
    if (!/^[a-z0-9-]+\.webp$/.test(file) || metadata.status !== "Approved") {
      throw new Error("Night Watch requires approved, bundled WebP artwork.");
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
  return {
    ...publicAppearanceSkin(skin),
    backgroundData: byId.get(skin.backgroundAsset),
    ...resolveDesignArtwork(skin, id => byId.get(id)),
  };
}
