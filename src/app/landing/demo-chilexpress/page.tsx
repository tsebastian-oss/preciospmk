import { redirect } from "next/navigation";

export default function ChilexpressDemoPage() {
  redirect("/login?next=/panel");
}
