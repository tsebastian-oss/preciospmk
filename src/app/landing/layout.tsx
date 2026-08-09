import "./marketing-global.css";
import MarketingMobileMenu from "./MarketingMobileMenu";

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="mgp-marketing-scope"><MarketingMobileMenu />{children}</div>;
}
