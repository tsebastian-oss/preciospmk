const BASE_URL = (process.env.BASE_URL || "https://preciospmk.vercel.app").replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    redirect: options.redirect || "follow",
    signal: AbortSignal.timeout(30_000),
    ...options,
  });
  return response;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStatus(path, expected, options = {}) {
  const response = await request(path, options);
  assert(expected.includes(response.status), `${path}: esperaba ${expected.join("/")} y respondió ${response.status}`);
  return response;
}

async function expectBody(path, markers) {
  const response = await expectStatus(path, [200]);
  const body = await response.text();
  for (const marker of markers) assert(body.includes(marker), `${path}: falta contenido esperado ${marker}`);
  return body;
}

async function main() {
  const publicPages = [
    "/",
    "/registro",
    "/login",
    "/forgot-password",
    "/auth/recovery",
    "/auth/confirm",
  ];

  await Promise.all(publicPages.map((path) => expectStatus(path, [200])));

  const legacyMarketingPaths = [
    "/landing",
    "/landing/demo",
    "/landing/soluciones",
    "/landing/modulos",
    "/landing/cobertura",
    "/landing/precios",
    "/landing/contacto",
  ];
  await Promise.all(legacyMarketingPaths.map(async (path) => {
    const response = await expectStatus(path, [307, 308], { redirect: "manual" });
    assert(
      (response.headers.get("location") || "").startsWith("https://www.mgpconsultoria.cl/super-precios"),
      `${path} no redirige al sitio comercial vigente`,
    );
  }));

  const landingBody = await expectBody("/", ["Ver demo del producto", "Revisar cobertura actual", "MGP Super Precios", "Abrir menú"]);
  assert(!landingBody.includes("Competitive AI"), "landing todavía contiene Competitive AI");
  assert(!landingBody.includes("AI Price Optimizer"), "landing todavía contiene AI Price Optimizer");

  const coverage = await expectStatus("/api/public/coverage", [200]);
  const coverageJson = await coverage.json();
  assert(Array.isArray(coverageJson?.retailers), "coverage.retailers no es un array");
  assert(coverageJson.retailers.length >= 3, "la cobertura pública no tiene suficientes retailers");
  assert(coverageJson.retailers.every((item) => item?.name && item?.freshnessStatus), "la cobertura pública tiene filas incompletas");

  await Promise.all(["/onboarding", "/cuenta", "/cuenta/equipo", "/trial-expired"].map(async (path) => {
    const response = await expectStatus(path, [307, 308], { redirect: "manual" });
    assert((response.headers.get("location") || "").includes("/login"), `${path} no redirige a login sin sesión`);
  }));

  const protectedReset = await expectStatus("/reset-password", [307, 308], { redirect: "manual" });
  assert((protectedReset.headers.get("location") || "").includes("/forgot-password"), "/reset-password no protege correctamente una sesión ausente");

  const privateApis = ["/api/products", "/api/brand-chat/history", "/api/price-map-ai/history", "/api/data-exports", "/api/alerts", "/api/enterprise/account"];
  await Promise.all(privateApis.map((path) => expectStatus(path, [401])));

  const health = await expectStatus("/api/health", [200]);
  const healthJson = await health.json();
  assert(healthJson?.status === "ok", "health.status no es ok");
  assert(healthJson?.supabase?.dispatcherActive === true, "dispatcher de scraping no está activo");
  assert(healthJson?.supabase?.dataHealthCheckedAt, "falta timestamp de control de frescura de datos");

  const login = await expectStatus("/login", [200]);
  assert(login.headers.get("x-content-type-options") === "nosniff", "falta X-Content-Type-Options");
  assert(login.headers.get("x-frame-options") === "DENY", "falta X-Frame-Options");
  assert(Boolean(login.headers.get("referrer-policy")), "falta Referrer-Policy");
  assert(Boolean(login.headers.get("permissions-policy")), "falta Permissions-Policy");

  const invalidContact = await request("/api/public/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(invalidContact.status === 400, `contacto inválido debía responder 400 y respondió ${invalidContact.status}`);

  const invalidRecovery = await request("/api/auth/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "no-es-email" }),
  });
  assert(invalidRecovery.status === 400, `recovery inválido debía responder 400 y respondió ${invalidRecovery.status}`);

  const invalidConfirmation = await request("/api/auth/confirmation/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(invalidConfirmation.status === 400, `confirmación vacía debía responder 400 y respondió ${invalidConfirmation.status}`);

  const predictablePassword = await request("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Security Smoke",
      email: "security-smoke@example.com",
      company: "Smoke Test Company",
      password: "Password123!",
      acceptedTerms: true,
      startedAt: Date.now() - 10_000,
    }),
  });
  assert(
    [400, 403].includes(predictablePassword.status),
    `contraseña predecible debía bloquearse con 400/403 y respondió ${predictablePassword.status}`,
  );
  const passwordPayload = await predictablePassword.json().catch(() => ({}));
  if (predictablePassword.status === 400) {
    assert(/predecible|secuencias|comunes/i.test(String(passwordPayload?.error || "")), "la política de contraseña no devolvió un mensaje seguro esperado");
  }

  console.log("Production readiness smoke OK: marketing mobile, demo, coverage, signup confirmation, auth protection, hardened passwords, alerts, customer account and health validated");
}

main().catch((error) => {
  console.error(`Production readiness smoke FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
