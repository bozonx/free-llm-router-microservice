export async function* parseSseJsonStream<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  const reader = body.getReader();

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) {
        continue;
      }

      if (trimmed === 'data: [DONE]') {
        return;
      }

      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice('data: '.length);
        yield JSON.parse(jsonStr) as T;
      }
    }
  }
}
