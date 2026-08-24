# Pricing B2B source layers

The Courier & Logistics matrix separates observed prices by evidence layer:

- `public`: official/published commercial tariff cards and public quote outputs.
- `b2b`: verified unit rates observed in public procurement offers, economic annexes, awarded-rate evidence or purchase orders.
- `best`: lowest verified price per provider and homogeneous shipment profile across the public and B2B layers.

Mercado Público annex ingestion uses only the public individual `Ver Anexo` flow. It does not automate or bypass bulk-download CAPTCHA. PDF contents are parsed server-side; a rate enters `b2b_rate_comparables` only when provider, unit price, destination/route and weight/base can be established with high confidence. Ambiguous or scanned documents are recorded in `b2b_public_annex_extractions` without generating a price.

Aggregate contracts, nominal CLP 1 awards, budgets and evaluation scores are not converted into per-shipment pricing.
