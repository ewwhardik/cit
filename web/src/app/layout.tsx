import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { landingFonts } from "@/components/landing/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CIT Scheduler", template: "%s · CIT Scheduler" },
  description: "Timetables, exams and venue bookings for Chilika Institute of Technology.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a08" },
  ],
};

// Applied before paint so there is no light/dark flash.
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${landingFonts}`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <Toaster position="bottom-right" toastOptions={{ className: "text-[13px]" }} />
      </body>
    </html>
  );
}
