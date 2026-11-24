import { readFile } from "node:fs/promises";
import { decodeStagingAppearancePack } from "../../client/staging-appearance-review.js";
import { APPEARANCE_ACHIEVEMENTS, NIGHT_WATCH_SKIN_ID, PRISMATIC_CONFLUENCE_SKIN_ID, PRISMATIC_PATH_ACHIEVEMENT } from "./appearance-milestones.js";
import { NIGHT_SHIFT_ACHIEVEMENT } from "./account-history.js";

export const SKIN_ACHIEVEMENTS = Object.freeze({
  ...APPEARANCE_ACHIEVEMENTS,
  [NIGHT_WATCH_SKIN_ID]: NIGHT_SHIFT_ACHIEVEMENT,
  [PRISMATIC_CONFLUENCE_SKIN_ID]: PRISMATIC_PATH_ACHIEVEMENT,
});

export const isAchievementSkin = id => Object.hasOwn(SKIN_ACHIEVEMENTS, id);

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
  return skins.filter(skin => Object.hasOwn(APPEARANCE_ACHIEVEMENTS, skin.id));
}
