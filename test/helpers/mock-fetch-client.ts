import type { FetchClient } from '../../src/http/fetch-client.js';

interface MockResponseSpec {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

interface RequestKey {
  method: string;
  url: string;
}

function keyOf(req: RequestKey): string {
  return `${req.method.toUpperCase()} ${req.url}`;
}

export class MockFetchClient implements FetchClient {
  private readonly responses = new Map<string, MockResponseSpec[]>();
  private readonly calls = new Map<string, number>();

  public setResponse(params: { method: string; url: string; response: MockResponseSpec }): void {
    this.setResponses({
      method: params.method,
      url: params.url,
      responses: [params.response],
    });
  }

  public setResponses(params: {
    method: string;
    url: string;
    responses: MockResponseSpec[];
  }): void {
    this.responses.set(keyOf({ method: params.method, url: params.url }), [...params.responses]);
  }

  public getCallCount(params: { method: string; url: string }): number {
    return this.calls.get(keyOf(params)) ?? 0;
  }

  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const method = init?.method?.toUpperCase() ?? 'GET';
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    const key = keyOf({ method, url });
    this.calls.set(key, (this.calls.get(key) ?? 0) + 1);

    const queue = this.responses.get(key);
    if (!queue || queue.length === 0) {
      throw new Error(`MockFetchClient: no mocked response for ${key}`);
    }

    const spec = queue.length > 1 ? queue.shift()! : queue[0]!;

    return new Response(spec.body ?? '', {
      status: spec.status,
      headers: spec.headers,
    });
  }
}
