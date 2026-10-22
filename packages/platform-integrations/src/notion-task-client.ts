import { taskStatus, type TaskStatus } from './notion-task-status';
import { notionObject } from './notion-task-types';

export class NotionTaskApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs = 60_000,
    readonly retryable = true,
    readonly effectMayHaveApplied = false,
  ) {
    super(`Notion task request failed: ${code}`);
    this.name = 'NotionTaskApiError';
  }
}
export interface NotionList {
  results: unknown[];
  nextCursor: string | null;
}
function id(value: string): string {
  if (!/^[a-f0-9]{32}$|^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    throw new NotionTaskApiError('invalid_identifier', 60_000, false);
  return value;
}
async function json(response: Response): Promise<unknown> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  const reader = body?.getReader();
  if (!reader) throw new NotionTaskApiError('invalid_response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new NotionTaskApiError('response_too_large');
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch (error) {
    if (error instanceof NotionTaskApiError) throw error;
    throw new NotionTaskApiError('invalid_response');
  } finally {
    reader.releaseLock();
  }
}
function list(value: unknown, limit: number): NotionList {
  const row = notionObject(value),
    status = notionObject(row.request_status);
  if (
    !Array.isArray(row.results) ||
    row.results.length > limit ||
    typeof row.has_more !== 'boolean' ||
    status.type === 'incomplete' ||
    status.incomplete_reason ||
    (row.has_more &&
      (typeof row.next_cursor !== 'string' || !row.next_cursor || row.next_cursor.length > 2048)) ||
    (!row.has_more && row.next_cursor !== null)
  )
    throw new NotionTaskApiError('incomplete_response');
  return {
    results: row.results as unknown[],
    nextCursor: row.has_more ? (row.next_cursor as string) : null,
  };
}
export class NotionTaskClient {
  private readonly fetcher: typeof fetch;
  private requests = 0;
  private notBefore = 0;
  constructor(
    private readonly token: string,
    fetcher: typeof fetch = fetch,
    private readonly budget?: { maxRequests: number; deadline: number; clock: () => Date },
    private readonly onBackoff?: (retryAfterMs: number) => Promise<void>,
  ) {
    this.fetcher = fetcher.bind(globalThis);
  }

  private requestTimeout(): number {
    const now = this.budget?.clock().getTime() ?? Date.now();
    if (now < this.notBefore)
      throw new NotionTaskApiError('provider_cooldown', this.notBefore - now);
    const remaining = this.budget ? this.budget.deadline - this.budget.clock().getTime() : 10_000;
    if (this.budget && (this.requests >= this.budget.maxRequests || remaining <= 0))
      throw new NotionTaskApiError('request_budget_exceeded');
    this.requests++;
    return Math.max(1, Math.min(10_000, remaining));
  }
  private async noteBackoff(delay: number): Promise<void> {
    this.notBefore = (this.budget?.clock().getTime() ?? Date.now()) + delay;
    await this.onBackoff?.(delay);
  }
  private async reject(response: Response, method: 'GET' | 'POST' | 'PATCH'): Promise<never> {
    const delay = Number(response.headers.get('Retry-After')) * 1000;
    await response.body?.cancel();
    const retryAfterMs = Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86_400_000) : 60_000;
    if (response.status === 429 || response.status >= 500) {
      await this.noteBackoff(retryAfterMs);
    }
    throw new NotionTaskApiError(
      `http_${response.status}`,
      retryAfterMs,
      response.status === 429 || response.status >= 500,
      method !== 'GET' && response.status >= 500,
    );
  }
  private async request(
    path: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: unknown,
  ): Promise<unknown> {
    if (!this.token.trim()) throw new NotionTaskApiError('missing_credential', 60_000, false);
    const timeout = this.requestTimeout();
    let response: Response;
    try {
      response = await this.fetcher(`https://api.notion.com/v1/${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': '2025-09-03',
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      await this.noteBackoff(60_000);
      throw new NotionTaskApiError('transport_unavailable', 60_000, true, method !== 'GET');
    }
    if (!response.ok) return this.reject(response, method);
    try {
      return await json(response);
    } catch (error) {
      if (error instanceof NotionTaskApiError && method !== 'GET')
        throw new NotionTaskApiError(error.code, error.retryAfterMs, error.retryable, true);
      throw error;
    }
  }
  createTaskComment(pageId: string, richText: unknown[]): Promise<unknown> {
    return this.request('comments', 'POST', {
      parent: { page_id: id(pageId) },
      rich_text: richText,
    });
  }
  completeTask(pageId: string, statusProperty: string): Promise<unknown> {
    return this.setTaskStatus(pageId, statusProperty, 'Done');
  }
  setTaskStatus(pageId: string, statusProperty: string, status: TaskStatus): Promise<unknown> {
    if (!taskStatus(status)) throw new NotionTaskApiError('invalid_status', 60_000, false);
    return this.request(`pages/${id(pageId)}`, 'PATCH', {
      properties: { [statusProperty]: { status: { name: status } } },
    });
  }
  async listTaskComments(pageId: string, cursor: string | null = null): Promise<NotionList> {
    const query = new URLSearchParams({
      block_id: id(pageId),
      page_size: '100',
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    return list(await this.request(`comments?${query.toString()}`, 'GET'), 100);
  }
  async queryTasks(sourceId: string, cursor: string | null = null): Promise<NotionList> {
    return list(
      await this.request(`data_sources/${id(sourceId)}/query`, 'POST', {
        page_size: 20,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
      20,
    );
  }
  async queryTasksForProject(input: {
    sourceId: string;
    projectField: string;
    projectId: string;
    assigneeField: string;
    assigneeId?: string | undefined;
    cursor?: string | null | undefined;
  }): Promise<NotionList> {
    const project = { property: input.projectField, relation: { contains: id(input.projectId) } };
    const filter = input.assigneeId
      ? {
          and: [project, { property: input.assigneeField, people: { contains: input.assigneeId } }],
        }
      : project;
    return list(
      await this.request(`data_sources/${id(input.sourceId)}/query`, 'POST', {
        page_size: 25,
        filter,
        ...(input.cursor ? { start_cursor: input.cursor } : {}),
      }),
      25,
    );
  }
  readSelf(): Promise<unknown> {
    return this.request('users/me', 'GET');
  }
  readPage(pageId: string): Promise<unknown> {
    return this.request(`pages/${id(pageId)}`, 'GET');
  }
  async listBlockChildren(pageId: string, cursor: string | null = null): Promise<NotionList> {
    const query = new URLSearchParams({
      page_size: '100',
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    return list(
      await this.request(`blocks/${id(pageId)}/children?${query.toString()}`, 'GET'),
      100,
    );
  }
  appendBlockChildren(pageId: string, children: unknown[]): Promise<unknown> {
    if (!children.length || children.length > 100)
      throw new NotionTaskApiError('invalid_blocks', 60_000, false);
    return this.request(`blocks/${id(pageId)}/children`, 'PATCH', { children });
  }
  updateBlock(blockId: string, body: unknown): Promise<unknown> {
    return this.request(`blocks/${id(blockId)}`, 'PATCH', body);
  }
  async readProperty(
    pageId: string,
    propertyId: string,
    cursor: string | null = null,
  ): Promise<NotionList> {
    const query = new URLSearchParams({
      page_size: '100',
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    const property = encodeURIComponent(decodeURIComponent(propertyId));
    return list(
      await this.request(`pages/${id(pageId)}/properties/${property}?${query.toString()}`, 'GET'),
      100,
    );
  }
}
