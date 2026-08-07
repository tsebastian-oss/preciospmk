import "./marketing-global.css";

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="mgp-marketing-scope">{children}</div>;
}
