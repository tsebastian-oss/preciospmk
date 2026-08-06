export type QueryOptions = {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
  countMode?: "exact" | "planned" | "estimated";
};

export type SupabaseResult<T> = {
  data: T;
  count: number | null;
};

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function configuration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

async function supabaseRequest<T>(
  path: string,
  options: QueryOptions = {},
): Promise<SupabaseResult<T>> {
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
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message}`);
  }

  const contentRange = response.headers.get("content-range");
  const totalPart = contentRange?.split("/").at(-1);
  const count = totalPart && totalPart !== "*" ? Number(totalPart) : null;

  if (response.status === 204) {
    return { data: undefined as T, count };
  }

  return {
    data: await response.json() as T,
    count: Number.isFinite(count) ? count : null,
  };
}

export async function supabaseRest<T>(
  path: string,
  options: QueryOptions = {},
): Promise<T> {
  const result = await supabaseRequest<T>(path, options);
  return result.data;
}

export async function supabaseRestWithCount<T>(
  path: string,
  options: QueryOptions = {},
): Promise<SupabaseResult<T>> {
  const { countMode = "planned", ...requestOptions } = options;
  const prefer = [requestOptions.prefer, `count=${countMode}`].filter(Boolean).join(",");
  return supabaseRequest<T>(path, { ...requestOptions, prefer });
}
