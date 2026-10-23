import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DPM Desk",
  description: "Local-first discretionary portfolio management workbench",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
