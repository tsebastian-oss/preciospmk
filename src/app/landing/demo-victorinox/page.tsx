import { redirect } from "next/navigation";

export default function VictorinoxDemoPage() {
  redirect("/login?client=victorinox");
}
