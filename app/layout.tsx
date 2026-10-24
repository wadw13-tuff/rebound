import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Rebound — Your plan moves with you",
  description:
    "Flexible strength training for real life. Build a plan, log your workouts, and find your way back without the guilt.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Rebound" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F7F7F2",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="system">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const saved = localStorage.getItem('rebound-theme'); if (saved === 'light' || saved === 'dark' || saved === 'system') document.documentElement.dataset.theme = saved; } catch (_) {} })();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
