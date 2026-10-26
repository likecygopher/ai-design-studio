import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { AuthSessionProvider } from "@/src/components/AuthSessionProvider";
import { I18nProvider } from "@/src/i18n/I18nProvider";
import { getLocale } from "@/src/i18n/server";
import "./globals.css";

const gotham = localFont({
  src: [
    {
      path: "../需求/Font/Gotham-Light.otf",
      weight: "300",
      style: "normal"
    },
    {
      path: "../需求/Font/Gotham-LightIta.otf",
      weight: "300",
      style: "italic"
    },
    {
      path: "../需求/Font/Gotham-Book.otf",
      weight: "400",
      style: "normal"
    },
    {
      path: "../需求/Font/Gotham-BookIta.otf",
      weight: "400",
      style: "italic"
    },
    {
      path: "../需求/Font/Gotham-Medium.otf",
      weight: "500",
      style: "normal"
    },
    {
      path: "../需求/Font/Gotham-MediumIta.otf",
      weight: "500",
      style: "italic"
    },
    {
      path: "../需求/Font/Gotham-Bold.otf",
      weight: "700",
      style: "normal"
    },
    {
      path: "../需求/Font/Gotham-BoldIta.otf",
      weight: "700",
      style: "italic"
    },
    {
      path: "../需求/Font/Gotham-Ultra.otf",
      weight: "800",
      style: "normal"
    },
    {
      path: "../需求/Font/Gotham-UltraIta.otf",
      weight: "800",
      style: "italic"
    },
    {
      path: "../需求/Font/Gotham-Black.otf",
      weight: "900",
      style: "normal"
    },
    {
      path: "../需求/Font/Gotham-BlackIta.otf",
      weight: "900",
      style: "italic"
    }
  ],
  display: "swap",
  variable: "--font-gotham"
});

export const metadata: Metadata = {
  title: "Midea AI Content Studio",
  description: "Multi-user AI product marketing content platform"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html className={gotham.variable} lang={locale === "en" ? "en" : "zh-CN"}>
      <head>
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
      </head>
      <body>
        <I18nProvider locale={locale}>
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
