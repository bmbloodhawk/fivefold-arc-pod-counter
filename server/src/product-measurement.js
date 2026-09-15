const EVENTS = new Set([
  "pod_creation_started", "pod_creation_succeeded", "join_attempted", "join_succeeded",
  "seat_claim_succeeded", "seat_claim_failed", "second_player_joined", "game_started",
  "reconnected", "version_conflict", "server_error", "setup_abandoned",
  "game_completed", "account_invitation_shown", "sign_in_started", "sign_in_completed",
  "personal_game_saved", "profile_opened", "deck_selected", "deck_created",
]);

const FEATURES = new Set([
  "commander_setup", "commander_tax", "poison", "commander_damage", "custom_life",
  "turn_tracking", "turn_cue", "qr_invite", "invite_link", "card_advisor", "declared_winner",
]);

const FAILURE_CATEGORIES = new Set([
  "invalid_code", "room_not_found", "room_full", "seat_unavailable", "version_conflict",
  "connection", "server", "unknown",
]);

const EVENT_FIELDS = new Set(["event", "feature", "failureCategory"]);

export function productMeasurementRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Measurement input must be an object");
  const extra = Object.keys(input).filter((key) => !EVENT_FIELDS.has(key));
  if (extra.length) throw new TypeError(`Measurement field is not allowed: ${extra[0]}`);
  if (!EVENTS.has(input.event) && input.event !== "feature_used") throw new TypeError("Measurement event is not allowed");
  if (input.event === "feature_used") {
    if (!FEATURES.has(input.feature) || input.failureCategory !== undefined) throw new TypeError("Feature measurement is invalid");
    return Object.freeze({ schemaVersion: 1, event: input.event, feature: input.feature });
  }
  if (input.feature !== undefined) throw new TypeError("Feature is allowed only for feature_used");
  if (input.failureCategory !== undefined && !FAILURE_CATEGORIES.has(input.failureCategory)) throw new TypeError("Failure category is invalid");
  if (input.failureCategory !== undefined && !["seat_claim_failed", "server_error"].includes(input.event)) throw new TypeError("Failure category is not allowed for this event");
  return Object.freeze({ schemaVersion: 1, event: input.event, ...(input.failureCategory ? { failureCategory: input.failureCategory } : {}) });
}

export class ProductMeasurement {
  constructor({ enabled = false, write = () => {} } = {}) { this.enabled = enabled; this.write = write; }
  record(input) {
    if (!this.enabled) return false;
    this.write(productMeasurementRecord(input));
    return true;
  }
}

export function productMeasurementSummary(records) {
  const summary = { events: {}, features: {}, failures: {} };
  for (const raw of records) {
    const record = productMeasurementRecord(raw);
    summary.events[record.event] = (summary.events[record.event] || 0) + 1;
    if (record.feature) summary.features[record.feature] = (summary.features[record.feature] || 0) + 1;
    if (record.failureCategory) summary.failures[record.failureCategory] = (summary.failures[record.failureCategory] || 0) + 1;
  }
  return summary;
}
