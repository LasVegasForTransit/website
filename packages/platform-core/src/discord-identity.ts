export interface DiscordIdentity {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
}

export function isDiscordId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,19}$/.test(value) &&
    BigInt(value) <= 18446744073709551615n
  );
}

export function isDiscordIdentity(value: DiscordIdentity): boolean {
  return (
    isDiscordId(value.id) &&
    typeof value.username === 'string' &&
    value.username.length > 0 &&
    value.username.length <= 32 &&
    (value.displayName === null ||
      (typeof value.displayName === 'string' && value.displayName.length <= 32)) &&
    (value.avatar === null ||
      (typeof value.avatar === 'string' && /^(a_)?[a-f0-9]{32}$/.test(value.avatar)))
  );
}
