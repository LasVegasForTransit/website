/** Keep new account sections in their registered order without mutating the registrations. */
export function orderAccountSections<T extends { position: number }>(sections: readonly T[]): T[] {
  return [...sections].sort((left, right) => left.position - right.position);
}
