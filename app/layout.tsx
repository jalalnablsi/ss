'use client';

import { Outfit } from 'next/font/google';
import Script from 'next/script';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import './globals.css'; // Global styles

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${outfit.variable} dark`} suppressHydrationWarning>
      <head>
        <title>Tap To Earn</title>
        <meta name="description" content="Tap to Earn Telegram Mini App" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, theme-color=#050505" />
        {/* Telegram Web App SDK */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {/* Adsgram.io SDK for Telegram Mini Apps */}
        <Script src="https://sad.adsgram.ai/js/sad.min.js" strategy="beforeInteractive" />
      </head>
      <body className="bg-[#050505] text-white font-outfit antialiased select-none touch-manipulation overflow-hidden overscroll-none" suppressHydrationWarning>
        <TonConnectUIProvider manifestUrl="https://tap-to-earn-demo.vercel.app/tonconnect-manifest.json">
          {children}
        </TonConnectUIProvider>
      </body>
    </html>
  );
}
