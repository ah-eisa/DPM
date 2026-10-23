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
        <nav aria-label="DPM Desk navigation" style={{position:"fixed",right:18,bottom:18,zIndex:100,display:"flex",gap:8,padding:8,borderRadius:12,background:"rgba(8,17,31,.92)",border:"1px solid #20334d",boxShadow:"0 10px 28px rgba(0,0,0,.28)"}}>
          <a href="/" style={{color:"#dce7f7",textDecoration:"none",padding:"8px 10px",borderRadius:8,border:"1px solid #2a3d58"}}>Dashboard</a>
          <a href="/operations" style={{color:"#08111f",textDecoration:"none",padding:"8px 10px",borderRadius:8,background:"#d9efff",fontWeight:700}}>Operations</a>
        </nav>
      </body>
    </html>
  );
}
