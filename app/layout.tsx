import type { Metadata } from "next";
import "./funnel.css";
export const metadata: Metadata = { title: "iCash X | AI for Real Estate Wholesaling", description: "See how an AI wholesaling operation can find opportunities, work permitted seller conversations, and move deals toward closing. Try the free simulation.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
