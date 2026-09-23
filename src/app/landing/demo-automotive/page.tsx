import { redirect } from "next/navigation";

export default function AutomotiveDemoPage() {
  redirect("/login?client=automotive&next=/automotive-panel");
}
