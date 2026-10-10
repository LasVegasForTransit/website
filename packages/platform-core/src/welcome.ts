export const WELCOME_METHODS = ['email', 'phone', 'discord', 'in_person'] as const;
export type WelcomeMethod = (typeof WELCOME_METHODS)[number];
export interface WelcomeClaim {
  id: string;
  personId: string;
  actorId: string;
  claimedAt: string;
  expiresAt: string;
}
export interface WelcomeContact {
  interests: string[];
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
}
export interface WelcomeQueueRow {
  personId: string;
  givenName: string | null;
  familyName: string | null;
  joinedAt: string;
  overdue: boolean;
  claimedBy: string | null;
  claimedByName: string | null;
  claimExpiresAt: string | null;
}
