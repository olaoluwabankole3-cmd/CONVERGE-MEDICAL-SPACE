import type { Metadata } from "next";
import "./globals.css";
import "./auth-design.css";
import "./converge-brand.css";
import "./medical-landing.css";

export const metadata: Metadata = {
  title: "Converge Medical Intelligence | Connected hospital operations",
  description: "Coordinate hospital access, requests, appointments, follow-ups and operational work in one governed workspace."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
