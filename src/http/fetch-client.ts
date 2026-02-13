export interface FetchClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
