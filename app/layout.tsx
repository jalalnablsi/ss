'use client';

import { Outfit } from 'next/font/google';
import Script from 'next/script';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { useEffect, useState } from 'react';
import './globals.css'; // Global styles

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });

export default function RootLayout({children}: {children: React.ReactNode}) {
  const [manifestUrl, setManifestUrl] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManifestUrl(`${window.location.origin}/api/tonconnect-manifest.json`);
  }, []);

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
        {manifestUrl ? (
          <TonConnectUIProvider manifestUrl={manifestUrl}>
            {children}
          </TonConnectUIProvider>
        ) : (
          <div className="min-h-screen bg-[#050505] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </body>
    </html>
  );
}
