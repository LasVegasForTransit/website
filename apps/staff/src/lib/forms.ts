export function field(form: FormData, name: string, limit = 254): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.slice(0, limit) : '';
}
export function fromSameOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
