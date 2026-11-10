// Short reminders for hover tooltips, written in our own words. The Codex on sorcerytcg.com is the
// authority; tooltips link there instead of restating rulings.
// Per-entry Codex ids (sorcerytcg.com/codex/<id>) are not known to this project yet: there is no
// primary source for them in the repo, so links go to the Codex index until ids are filled in below.
export const CODEX_INDEX = 'https://sorcerytcg.com/codex';
export const CODEX_IDS: Record<string, string> = {
  // Airborne: '<id>',
};
export function codexUrl(keyword: string): string {
  const id = CODEX_IDS[keyword];
  return id ? `${CODEX_INDEX}/${id}` : CODEX_INDEX;
}
export const KEYWORD_HELP: Record<string, { text: string; enforced: boolean }> = {
  Airborne: { text: 'May step diagonally on the surface. Only Airborne units can attack it; only Airborne or Ranged units can intercept it.', enforced: true },
  Burrowing: { text: 'Can go underground at land sites and move there.', enforced: true },
  Charge: { text: 'Can tap (move, attack) on the turn it is summoned.', enforced: true },
  Deathrite: { text: 'Does something when it dies, before going to the cemetery.', enforced: true },
  Disabled: { text: 'Loses its abilities, does not strike, and cannot act.', enforced: true },
  Flood: { text: 'A flooded site counts as a water site.', enforced: false },
  Genesis: { text: 'Does something when it enters the realm.', enforced: true },
  Immobile: { text: 'Cannot take steps.', enforced: true },
  Lance: { text: 'Its first strike deals +1 damage and strikes first; then the lance breaks.', enforced: true },
  Landbound: { text: 'Disabled while not on land.', enforced: true },
  Lethal: { text: 'Any damage it deals to a minion kills that minion.', enforced: true },
  Movement: { text: 'May take extra steps when moving or defending.', enforced: true },
  Ranged: { text: 'May tap to shoot a projectile in a straight line; it strikes the first enemy hit and takes no strike back.', enforced: true },
  Spellcaster: { text: 'Can cast spells. Targeted magic is measured from a spellcaster you control.', enforced: true },
  Stealth: { text: 'Cannot be targeted by enemy spells, intercepted, defended against, or shot. Lost once it strikes.', enforced: true },
  Submerge: { text: 'Can go underwater at water sites and move there.', enforced: true },
  Voidwalk: { text: 'Can enter void squares.', enforced: true },
  Ward: { text: 'Shown as a reminder only. This app does not enforce Ward yet.', enforced: false },
  Waterbound: { text: 'Disabled while not on a water site.', enforced: true },
  Threshold: { text: 'The element symbols on sites you control. A card needs at least its printed threshold; threshold is not spent.', enforced: true },
};
