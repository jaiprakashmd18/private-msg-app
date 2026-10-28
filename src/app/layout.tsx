import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { APP_NAME } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Private, invitation-only messaging.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#121218",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
