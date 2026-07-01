import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Player",
  description: "WebView video player",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function PlayerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="fixed inset-0 h-[100dvh] w-full overflow-hidden bg-black">
      {children}
    </div>
  );
}
