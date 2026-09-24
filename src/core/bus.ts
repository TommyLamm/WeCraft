export type Unsubscribe = () => void;

// Phase 2 game events (Task 2). Type-only additions — producers/consumers land
// with their own tasks (HUD/vitals, day-night, mobs, drops).
export type GameEvent =
  | { type: 'mode-changed'; mode: 'survival' | 'creative' }
  | { type: 'vitals-changed'; hp: number; maxHp: number; hunger: number; maxHunger: number }
  | { type: 'player-died' }
  | { type: 'time-changed'; phase: 'day' | 'night'; t: number }
  | { type: 'mobs-changed'; count: number }
  | { type: 'drops-changed' };

export interface Bus<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): Unsubscribe;
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}

export function createBus<Events extends Record<string, unknown>>(): Bus<Events> {
  const listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  return {
    on(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const wrapped = fn as (payload: never) => void;
      set.add(wrapped);
      return () => set!.delete(wrapped);
    },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          (fn as (p: Events[typeof type]) => void)(payload);
        } catch (err) {
          console.error('[bus] listener error', type, err);
        }
      }
    },
  };
}
