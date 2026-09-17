import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "LifeOS",
  description: "Personal operating system",
  applicationName: "LifeOS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "LifeOS",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F3EC" },
    { media: "(prefers-color-scheme: dark)", color: "#17150F" },
  ],
  width: "device-width",
  initialScale: 1,
  // No maximumScale: capping it at 1 disables pinch-zoom on iOS, which is an
  // accessibility failure, not a PWA nicety.
  viewportFit: "cover",
};

// Theme: system-following with an explicit override stored in localStorage
// (mirrors settings.theme). Applied before paint to avoid a flash.
const themeScript = `
try {
  var t = localStorage.getItem("lifeos-theme");
  var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
} catch (e) {}
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce from middleware; without it the theme script is
  // blocked in production (script-src carries no 'unsafe-inline').
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrains.variable}`}>
        {children}
      </body>
    </html>
  );
}
