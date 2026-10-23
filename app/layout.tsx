import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DPM Desk",
  description: "Local-first discretionary portfolio management workbench",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('dpm-desk-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}` }} />
        {children}
      </body>
    </html>
  );
}
