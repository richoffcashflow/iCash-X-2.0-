import type { Metadata } from "next";
import "./bot-funnel.css";
export const metadata: Metadata = { title: "iCash X | Real Estate Wholesaling, Made Easy", description: "Try the iCash X AI wholesaling bot in a free sandbox. See how it finds opportunities, works permitted seller conversations, and moves deals toward closing.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
