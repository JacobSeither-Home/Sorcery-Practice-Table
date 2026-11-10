import { useStore } from '../store';

/** Duration multiplier from Settings → Table → Pace (bigger = slower). */
export const usePace = () => useStore((s) => s.settings.pace ?? 1);

/**
 * A spring that takes `m` times as long as the base spring and keeps the same feel.
 * Settle time scales with sqrt(mass / stiffness), so mass × m² stretches time by m;
 * damping × m keeps the damping ratio unchanged.
 */
export const spring = (m: number, stiffness = 380, damping = 28) => ({ type: 'spring' as const, stiffness, damping: damping * m, mass: m * m });
