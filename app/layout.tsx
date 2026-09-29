import type { Metadata } from "next";
import "./beginner-workspace.css";
import "./clean-funnel.css";
export const metadata: Metadata = { title: "iCash X | Real Estate Wholesaling, Made Easy", description: "iCash X is an AI real estate wholesaling workspace for property research, seller follow-up, contracts, and closing coordination. Live acquisition is being connected.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

