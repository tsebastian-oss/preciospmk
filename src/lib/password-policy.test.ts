import { describe, expect, it } from "vitest";
import { passwordPolicyError } from "@/lib/password-policy";

describe("passwordPolicyError", () => {
  it("accepts a strong, unpredictable password", () => {
    expect(passwordPolicyError("Xk9$muroLagoTropa")).toBeNull();
  });

  it("rejects passwords that are too short", () => {
    expect(passwordPolicyError("Ab1$xz")).toBe("Usa entre 10 y 128 caracteres.");
  });

  it("rejects passwords longer than 128 characters", () => {
    const tooLong = `Ab1$${"z".repeat(130)}`;
    expect(passwordPolicyError(tooLong)).toBe("Usa entre 10 y 128 caracteres.");
  });

  it("requires at least three character classes", () => {
    expect(passwordPolicyError("solominusculas")).toBe(
      "Combina al menos tres tipos: mayúsculas, minúsculas, números o símbolos.",
    );
  });

  it("rejects common fragments regardless of accents or case", () => {
    expect(passwordPolicyError("MiContraseña123")).toBe(
      "Elige una contraseña menos predecible; evita palabras y secuencias comunes.",
    );
  });

  it("rejects brand-specific fragments", () => {
    expect(passwordPolicyError("SuperPrecios2020!")).toBe(
      "Elige una contraseña menos predecible; evita palabras y secuencias comunes.",
    );
  });

  it("rejects long single-character repetitions", () => {
    expect(passwordPolicyError("Baaaaa1!xyZq")).toBe(
      "Evita repetir el mismo carácter muchas veces.",
    );
  });

  it("rejects predictable sequences", () => {
    expect(passwordPolicyError("Zmq123456!a8")).toBe(
      "Evita secuencias fáciles de adivinar.",
    );
  });

  it("rejects passwords that embed the user's email identifier", () => {
    expect(
      passwordPolicyError("Juanito99!zqwT", { email: "juanito@empresa.cl" }),
    ).toBe("La contraseña no debe contener tu nombre, empresa o identificador de correo.");
  });

  it("rejects passwords that embed the company name", () => {
    expect(
      passwordPolicyError("Falabella99!zqwT", { company: "Falabella" }),
    ).toBe("La contraseña no debe contener tu nombre, empresa o identificador de correo.");
  });

  it("ignores short identity fragments below five characters", () => {
    expect(passwordPolicyError("Xk9$muroLagoTropa", { company: "MGP" })).toBeNull();
  });
});
