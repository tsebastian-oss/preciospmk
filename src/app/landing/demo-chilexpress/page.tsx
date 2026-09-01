"use client";

import ChilexpressMarketPanel from "../../ChilexpressMarketPanel";
import WhatsAppSupport from "../../WhatsAppSupport";
import styles from "../../panel/panel.module.css";

export default function ChilexpressDemoPage() {
  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.identity}>
        <div className={styles.mark}>M</div>
        <div><strong>MGP Price Intelligence</strong><span>Panel privado de pricing · preview</span></div>
      </div>
      <div className={styles.account}>
        <div><strong>Chilexpress</strong><span>Pricing Intelligence Workspace</span></div>
      </div>
    </header>
    <section className={styles.content}>
      <ChilexpressMarketPanel/>
    </section>
    <WhatsAppSupport brandName="Chilexpress" organizationName="Chilexpress" />
  </main>;
}
