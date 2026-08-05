import DataExportPortal from "./DataExportPortal";
import PlatformDashboard from "./PlatformDashboard";
import WeightedPricePulsePortal from "./WeightedPricePulsePortal";

export default function Home() {
  return <>
    <PlatformDashboard />
    <WeightedPricePulsePortal />
    <DataExportPortal />
  </>;
}
