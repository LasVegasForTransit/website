export function deploymentResponse(response: Response, environment: string): Response {
  if (environment !== 'preview') return response;
  const protectedResponse = new Response(response.body, response);
  protectedResponse.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  protectedResponse.headers.set('Cache-Control', 'private, no-store');
  return protectedResponse;
}

export const onRequest: PagesFunction<Pick<Env, 'LVBT_DEPLOYMENT_ENV'>> = async (context) =>
  deploymentResponse(await context.next(), context.env.LVBT_DEPLOYMENT_ENV);
