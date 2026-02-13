import type { FetchClient } from '../../http/fetch-client.js';

export class NodeFetchClient implements FetchClient {
  public async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}
