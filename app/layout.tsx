import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "관상사주 분석",
  description: "AI가 당신의 관상을 분석해 줍니다",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {children}
      </body>
    </html>
  );
}
