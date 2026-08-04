type QueryOptions = {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
};

function configuration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Supabase environment variables are missing");
  }
  return { url, publishableKey };
}

export async function supabaseRest<T>(path: string, options: QueryOptions = {}): Promise<T> {
  const { url, publishableKey } = configuration();
  const endpoint = new URL(`${url}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    endpoint.searchParams.set(key, value);
  }

  const response = await fetch(endpoint, {
    method: options.method ?? "GET",
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
      "content-type": "application/json",
      ...(options.prefer ? { prefer: options.prefer } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
