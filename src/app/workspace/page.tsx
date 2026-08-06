import DailyPricingChartPortal from "../DailyPricingChartPortal";
import DataExportPortal from "../DataExportPortal";
import EnterpriseAdminQuickLinks from "../EnterpriseAdminQuickLinks";
import EnterpriseAlertCenter from "../EnterpriseAlertCenter";
import EnterpriseReportCenter from "../EnterpriseReportCenter";
import EnterpriseReportFormatGuard from "../EnterpriseReportFormatGuard";
import EnterpriseSidebarLink from "../EnterpriseSidebarLink";
import IndustryGate from "../IndustryGate";
import PlatformDashboard from "../PlatformDashboard";
import PriceMatchLabelGuard from "../PriceMatchLabelGuard";
import PriceOptimizerPortal from "../PriceOptimizerPortal";
import WeightedPricePulsePortal from "../WeightedPricePulsePortal";

export default function WorkspacePage() {
  return <IndustryGate>
    <PlatformDashboard />
    <WeightedPricePulsePortal />
    <DataExportPortal />
    <EnterpriseSidebarLink />
    <EnterpriseAdminQuickLinks />
    <EnterpriseAlertCenter />
    <EnterpriseReportCenter />
    <EnterpriseReportFormatGuard />
    <PriceMatchLabelGuard />
    <PriceOptimizerPortal />
    <DailyPricingChartPortal />
  </IndustryGate>;
}
