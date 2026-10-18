import type { Metadata } from "next";
import "./globals.css";
import "./auth-design.css";
import "./converge-brand.css";

export const metadata: Metadata = {
  title: "Converge Medical Intelligence",
  description: "A coordinated workspace for hospital access and operations."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
