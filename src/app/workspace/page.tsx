import DataExportPortal from "../DataExportPortal";
import IndustryGate from "../IndustryGate";
import PlatformDashboard from "../PlatformDashboard";
import WeightedPricePulsePortal from "../WeightedPricePulsePortal";

export default function WorkspacePage() {
  return <IndustryGate>
    <PlatformDashboard />
    <WeightedPricePulsePortal />
    <DataExportPortal />
  </IndustryGate>;
}
