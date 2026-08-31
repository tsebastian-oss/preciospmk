"use client";

import { trackUsageEvent } from "@/lib/usage-client";
import styles from "./WhatsAppSupport.module.css";

type Props = {
  brandName?: string | null;
  organizationName?: string | null;
};

const SUPPORT_NUMBER = "56996743630";

export default function WhatsAppSupport({ brandName, organizationName }: Props) {
  const client = brandName || organizationName || "mi empresa";
  const message = [
    "Hola Sebastián,",
    `soy de ${client} y te escribo desde MGP Price Intelligence.`,
    "Quisiera hacer una consulta, pedir soporte o sugerir una mejora en la plataforma.",
  ].join("\n");

  const href = `https://wa.me/${SUPPORT_NUMBER}?text=${encodeURIComponent(message)}`;

  return (
    <a
      className={styles.support}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Contactar soporte por WhatsApp"
      title="Soporte MGP por WhatsApp"
      onClick={() =>
        trackUsageEvent("support_click", {
          module: "client-panel",
          metadata: {
            channel: "whatsapp",
            brand: brandName || null,
            organization: organizationName || null,
          },
        })
      }
    >
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 32 32" role="img">
          <path d="M16 3.4A12.4 12.4 0 0 0 5.2 21.9L3.6 28.6l6.9-1.6A12.4 12.4 0 1 0 16 3.4Zm0 22.5c-2 0-3.9-.6-5.6-1.6l-.4-.2-4.1 1 1.1-4-.3-.4A10.1 10.1 0 1 1 16 25.9Zm5.5-7.6c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-1.8-.9-3-1.6-4.2-3.7-.3-.5.3-.5.9-1.6.1-.2.1-.4 0-.6l-.9-2.1c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.4 1.4 3.6c.2.2 2.4 3.7 5.9 5.2 2.2 1 3 .9 4.1.8.7-.1 1.8-.7 2.1-1.4.3-.7.3-1.3.2-1.4-.2-.2-.4-.3-.7-.4Z"/>
        </svg>
      </span>
      <span className={styles.copy}>
        <strong>¿Necesitas ayuda?</strong>
        <small>Soporte por WhatsApp</small>
      </span>
    </a>
  );
}
