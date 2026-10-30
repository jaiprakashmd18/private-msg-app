import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { ViewportSync } from "@/components/pwa/viewport-sync";
import { APP_NAME } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Private, invitation-only messaging.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#121218",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android: the keyboard shrinks the page, so the message box stays visible.
  interactiveWidget: "resizes-content",
};

// Applies the saved theme before paint. Dark is the default.
const themeScript = `try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          richColors
          closeButton
          offset={{ top: "max(16px, calc(env(safe-area-inset-top) + 8px))" }}
          mobileOffset={{ top: "max(12px, calc(env(safe-area-inset-top) + 8px))" }}
        />
        <ServiceWorker />
        <ViewportSync />
      </body>
    </html>
  );
}
