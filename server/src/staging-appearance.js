import { readFile } from "node:fs/promises";
import { decodeStagingAppearancePack } from "../../client/staging-appearance-review.js";
import { APPEARANCE_ACHIEVEMENTS } from "./appearance-milestones.js";

export const isAchievementSkin = id => Object.hasOwn(APPEARANCE_ACHIEVEMENTS, id);

export async function loadStagingAppearanceSkins({ appEnv, path, key }) {
  if (appEnv !== "staging" || !key) return [];
  // The review ticket expires in the browser. A staged release is controlled
  // by the server setting and the account's earned achievements.
  const { skins } = await decodeStagingAppearancePack(await readFile(path), key);
  return skins.filter(skin => isAchievementSkin(skin.id));
}
