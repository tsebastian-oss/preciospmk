const COMMON_FRAGMENTS = [
  "password", "contraseña", "contrasena", "qwerty", "123456789", "987654321",
  "administrator", "administrador", "bienvenido", "welcome", "changeme", "letmein",
  "iloveyou", "abc123", "superprecios", "mgp2026", "preciospmk",
];

function normalized(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL");
}

function compact(value: string) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

export type PasswordContext = { email?: string | null; company?: string | null; displayName?: string | null };

export function passwordPolicyError(value: string, context: PasswordContext = {}) {
  if (value.length < 10 || value.length > 128) return "Usa entre 10 y 128 caracteres.";
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  if (classes < 3) return "Combina al menos tres tipos: mayúsculas, minúsculas, números o símbolos.";

  const lower = normalized(value);
  const packed = compact(value);
  if (COMMON_FRAGMENTS.some((fragment) => lower.includes(fragment) || packed.includes(compact(fragment)))) {
    return "Elige una contraseña menos predecible; evita palabras y secuencias comunes.";
  }
  if (/(.)\1{4,}/i.test(value)) return "Evita repetir el mismo carácter muchas veces.";
  if (/012345|123456|234567|345678|456789|abcdef|qwerty/i.test(packed)) return "Evita secuencias fáciles de adivinar.";

  const identityParts = [
    context.email?.split("@")[0],
    context.company,
    context.displayName,
  ].filter((item): item is string => Boolean(item))
    .flatMap((item) => compact(item).split(/\s+/))
    .map((item) => item.trim())
    .filter((item) => item.length >= 5);
  if (identityParts.some((part) => packed.includes(part))) {
    return "La contraseña no debe contener tu nombre, empresa o identificador de correo.";
  }
  return null;
}
