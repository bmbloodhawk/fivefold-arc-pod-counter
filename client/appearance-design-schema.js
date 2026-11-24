// Descriptors for the shared renderer and catalog allowlist. Only fields named in
// these records can reach the game. Omitted fields inherit the existing skin.
export const color = { type: 'color' };
export const id = { type: 'id' };
export const image = { type: 'image' };
export const number = (min, max) => ({ type: 'number', min, max });
export const choice = (...values) => ({ type: 'enum', values });
export const record = fields => ({ type: 'object', fields });
