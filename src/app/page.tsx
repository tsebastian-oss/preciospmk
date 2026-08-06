import DataExportPortal from "./DataExportPortal";
import ExecutiveDashboardV2 from "./ExecutiveDashboardV2";
import IndustryGate from "./IndustryGate";

export default function Home() {
  return <IndustryGate>
    <ExecutiveDashboardV2 />
    <DataExportPortal />
  </IndustryGate>;
}
