import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CelebSkin',
  description: 'Celebrity nude scenes from movies and TV shows',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
