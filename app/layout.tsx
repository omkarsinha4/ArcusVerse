import type { Metadata } from "next";
import { Comic_Neue } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const comic = Comic_Neue({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-comic"
});

export const metadata: Metadata = {
  title: "ArcusVerse — Live Sports Auction",
  description: "LAN sports player auction for local tournaments",
  icons: { icon: "/brand/logo.jpg" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${comic.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
