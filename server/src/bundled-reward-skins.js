import { readFile } from "node:fs/promises";
import { assertAppearanceValid, validateAppearanceSkin } from "../../client/appearance-validation.js";
import { materializeAppearanceSkin } from "./appearance-artwork-payload.js";
import { FIELD_NOTES_SKIN_ID, NIGHT_WATCH_SKIN_ID, PRISMATIC_CONFLUENCE_SKIN_ID } from "./appearance-milestones.js";
import { checkedAsset } from "./appearance-studio-boundary.js";

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
    return checkedAsset({ ...metadata, data: "data:image/webp;base64," + bytes.toString("base64") }, metadata.id);
  }));
  assertAppearanceValid(validateAppearanceSkin(skin, { assets: artwork, requireApprovedAssets: true, publish: true }));
  // Hydrate from the reviewed release once. The resulting renderer payload
  // stays on the server until the account or table access check succeeds.
  const bundledAppearance = await materializeAppearanceSkin(skin, { assets: artwork });
  return { ...skin, bundledAppearance };
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
