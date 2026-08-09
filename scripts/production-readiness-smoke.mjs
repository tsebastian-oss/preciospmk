const BASE_URL = (process.env.BASE_URL || "https://preciospmk.vercel.app").replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, { redirect: options.redirect || "follow", ...options });
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

async function main() {
  const publicPages = [
    "/",
    "/landing",
    "/landing/soluciones",
    "/landing/modulos",
    "/landing/precios",
    "/landing/contacto",
    "/login",
    "/forgot-password",
    "/auth/recovery",
  ];

  for (const path of publicPages) await expectStatus(path, [200]);

  const protectedPage = await expectStatus("/onboarding", [307, 308], { redirect: "manual" });
  assert((protectedPage.headers.get("location") || "").includes("/login"), "/onboarding no redirige a login sin sesión");

  const protectedReset = await expectStatus("/reset-password", [307, 308], { redirect: "manual" });
  assert((protectedReset.headers.get("location") || "").includes("/forgot-password"), "/reset-password no protege correctamente una sesión ausente");

  await expectStatus("/api/products", [401]);

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

  console.log("Production readiness smoke OK");
}

main().catch((error) => {
  console.error(`Production readiness smoke FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
