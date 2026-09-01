import { redirect } from "next/navigation";

export default function ChilexpressDemoEntryPage() {
  redirect("/login?next=/panel/chilexpress");
}
