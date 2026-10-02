import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { themeCookieName, parseTheme } from "@/lib/theme";
import { ErrorMessageBridge } from "@/components/error-message-bridge";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Client Books",
  description: "Multi-tenant client accounting platform",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const store = await cookies();
  const theme = parseTheme(store.get(themeCookieName)?.value);

  return (
    <html
      lang="en"
      // Omit data-theme entirely for "system" so the prefers-color-scheme
      // media query in globals.css decides — only force it for an explicit
      // light/dark choice.
      {...(theme !== "system" ? { "data-theme": theme } : {})}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ErrorMessageBridge />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
