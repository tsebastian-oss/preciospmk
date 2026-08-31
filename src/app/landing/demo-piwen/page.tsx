import { redirect } from "next/navigation";

export default function PiwenDemoPage() {
  redirect("/login?client=piwen");
}
