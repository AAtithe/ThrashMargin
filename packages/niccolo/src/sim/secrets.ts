import type { EventEffects, GameState, Secret } from './types';

type SecretSpec = NonNullable<EventEffects['secret']>;

/** Add a newly discovered secret, unless it's somehow already held (an event can only fire once, but stay defensive). */
export function addSecret(secrets: Secret[], week: number, spec: SecretSpec): Secret[] {
  if (secrets.some(s => s.id === spec.id)) return secrets;
  const secret: Secret = {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    value: spec.value,
    discoveredWeek: week,
    expiresWeek: spec.expiresInWeeks != null ? week + spec.expiresInWeeks : null,
    used: false,
    expired: false,
  };
  return [...secrets, secret];
}

/** Exploit or sell a held secret for cash — the same mechanical move, since no named buyers exist yet (Phase 8). */
export function useSecret(state: GameState, secretId: string): GameState {
  const secret = state.secrets.find(s => s.id === secretId);
  if (!secret) throw new Error('No such secret');
  if (secret.used) throw new Error(`${secret.name} has already been used`);
  if (secret.expired) throw new Error(`${secret.name} is no longer worth anything — the moment passed`);

  return {
    ...state,
    cash: state.cash + secret.value,
    secrets: state.secrets.map(s => (s.id === secretId ? { ...s, used: true } : s)),
  };
}

/** Any secret past its expiry week and never used quietly becomes worthless. */
export function resolveSecretExpiry(secrets: Secret[], week: number): Secret[] {
  return secrets.map(s =>
    !s.used && !s.expired && s.expiresWeek !== null && week > s.expiresWeek ? { ...s, expired: true } : s,
  );
}
