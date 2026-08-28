import { redirect } from "next/navigation";

export default function BodegasDonLuisDemoPage() {
  redirect("/login?client=bodegas-don-luis");
}
