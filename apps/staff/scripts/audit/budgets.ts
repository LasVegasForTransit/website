import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

export const STAFF_JAVASCRIPT_LIMIT = 35 * 1024;

interface ScriptResponse {
  body: string;
  status: number;
  url: string;
}

interface RouteScripts {
  url: string;
  scripts: Array<{ src?: string; code?: string }>;
  modulePreloads: string[];
  load: (url: string) => Promise<ScriptResponse>;
}

/** Count declared code even when CSP prevents execution; include the complete static module graph. */
export async function measureRouteJavaScript(input: RouteScripts) {
  const seen = new Set<string>();
  let gzipBytes = 0;
  let inlineScripts = 0;
  async function code(source: string, base: string) {
    gzipBytes += gzipSync(source).length;
    assert.ok(
      gzipBytes <= STAFF_JAVASCRIPT_LIMIT,
      `${new URL(input.url).pathname} exceeds 35 KB gzip JavaScript (${gzipBytes} bytes)`,
    );
    const imports: string[] = [];
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument: ts.Expression | undefined = node.arguments.at(0);
        assert.ok(
          argument && ts.isStringLiteralLike(argument),
          'dynamic imports must use literal paths so the route budget can follow them',
        );
        imports.push(argument.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(ts.createSourceFile(base, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
    for (const specifier of imports) await external(specifier, base);
  }
  async function external(src: string, base: string) {
    const url = new URL(src, base);
    assert.equal(
      url.origin,
      new URL(input.url).origin,
      'external script is outside the isolated audit',
    );
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const response = await input.load(url.href);
    assert.equal(response.status, 200, `script response was not successful: ${url.pathname}`);
    assert.equal(response.url, url.href, `script redirect hides code: ${url.pathname}`);
    await code(response.body, url.href);
  }
  for (const script of input.scripts) {
    if (script.src) await external(script.src, input.url);
    else if (script.code?.trim()) {
      inlineScripts++;
      await code(script.code, input.url);
    }
  }
  for (const src of input.modulePreloads) await external(src, input.url);
  return { gzipBytes, externalScripts: seen.size, inlineScripts };
}

export interface LighthouseReport {
  requestedUrl: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  runtimeError?: unknown;
  audits: Record<
    string,
    | {
        score: number | null;
        numericValue?: number;
        details?: { items?: Array<{ url?: string; statusCode?: number; resourceType?: string }> };
      }
    | undefined
  >;
  categories?: Record<string, { score: number | null }>;
}

export function assertAuthenticatedReport(result: LighthouseReport, expectedUrl: string) {
  assert.equal(result.runtimeError, undefined, 'Lighthouse reported a runtime error');
  assert.equal(result.requestedUrl, expectedUrl);
  assert.equal(
    result.finalDisplayedUrl ?? result.finalUrl,
    expectedUrl,
    'Lighthouse must render the authenticated route',
  );
  const document = result.audits['network-requests']?.details?.items?.find(
    (item) => item.url === expectedUrl && item.resourceType === 'Document',
  );
  assert.equal(document?.statusCode, 200, 'Lighthouse must receive a successful HTTP response');
}
