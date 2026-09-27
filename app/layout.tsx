import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "iCash X", description: "Your outbound real estate operation in one simple workspace.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
