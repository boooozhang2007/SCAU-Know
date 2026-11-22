import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/site";
import { PreferencesProvider } from "@/lib/preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: `「${SITE.name}」 ${SITE.nameEn}`,
  description: SITE.description,
  manifest: "/manifest.webmanifest",
  applicationName: SITE.name,
  appleWebApp: {
    capable: true,
    title: SITE.name,
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
  openGraph: {
    title: `「${SITE.name}」 ${SITE.nameEn}`,
    description: SITE.description,
    locale: "zh_CN",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111715" },
  ],
};

/**
 * 首屏 FOUC 预防脚本：紧随 <meta name="color-scheme"> 执行，
 * 仅在用户存有显式配色覆盖时更新 meta 与 data-theme，否则保持 light dark 跟随系统。
 */
const schemeInitScript = `(function(){try{var s=localStorage.getItem("scau-know-color-scheme");var m=document.querySelector('meta[name="color-scheme"]');if(s==="light"||s==="dark"){if(m)m.content=s;document.documentElement.dataset.theme=s;}else{if(m)m.content="light dark";}var l=localStorage.getItem("scau-know-lang");if(l==="en"||l==="zh")document.documentElement.dataset.language=l;}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-language="zh" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: schemeInitScript }} />
      </head>
      <body>
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
