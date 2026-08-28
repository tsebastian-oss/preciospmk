alter table public.brand_ai_conversations
  drop constraint if exists brand_ai_conversations_type_check;

alter table public.brand_ai_conversations
  add constraint brand_ai_conversations_type_check
  check (conversation_type = any (array[
    'brand'::text,
    'price_map'::text,
    'peru-liquor'::text
  ]));
