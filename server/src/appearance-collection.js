import { readFile } from "node:fs/promises";
import { decodeStagingAppearancePack } from "../../client/staging-appearance-review.js";
import { APPEARANCE_ACHIEVEMENTS } from "./appearance-milestones.js";

export const isAchievementSkin = id => Object.hasOwn(APPEARANCE_ACHIEVEMENTS, id);

export const isInvitationSkin = id => [
  "skin-1790476356864", // Fractured
  "skin-1789600182594", // Bart the Mailman
  "neutral", // Carl MTG
].includes(id);

export async function loadAppearanceSkins({ path, key }) {
  if (!key) return [];
  // Browser review links expire separately. Released art is served only
  // after the account's achievement or the table's authorized share is checked.
  const { skins } = await decodeStagingAppearancePack(await readFile(path), key);
  return skins.filter(skin => isAchievementSkin(skin.id));
}
