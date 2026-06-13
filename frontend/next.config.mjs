/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
  },
  serverRuntimeConfig: {
    MAILGUN_WEBHOOK_SECRET: process.env.MAILGUN_WEBHOOK_SECRET,
  },
  async headers() {
    // Persona avatars (/personas/*) and skill/lesson avatars (/lesson-images/*)
    // are stable brand assets at fixed paths, rendered fresh in every chat
    // bubble. Next.js serves /public with `private, max-age=0`, so the browser
    // revalidates the avatar on every bubble mount — a visible reload flash
    // between messages. Cache them so repeat renders come straight from memory;
    // stale-while-revalidate still picks up a swapped image within a day.
    const avatarCache = [
      { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
    ]
    return [
      { source: '/personas/:path*', headers: avatarCache },
      { source: '/lesson-images/:path*', headers: avatarCache },
    ]
  },
}

export default nextConfig
