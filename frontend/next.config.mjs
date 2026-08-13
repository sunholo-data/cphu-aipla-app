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
  async redirects() {
    return [
      { source: '/aipla', destination: '/project', permanent: true },
      { source: '/aipla/index.html', destination: '/project', permanent: true },
      { source: '/aipla/about.html', destination: '/project/about', permanent: true },
      { source: '/aipla/strands.html', destination: '/project/workstreams', permanent: true },
      { source: '/aipla/examples.html', destination: '/project/activities', permanent: true },
      { source: '/aipla/evaluation.html', destination: '/project/evaluation', permanent: true },
      { source: '/aipla/architecture.html', destination: '/project/platform', permanent: true },
      { source: '/aipla/self-hosting.html', destination: '/project/data-and-hosting', permanent: true },
      { source: '/aipla/timeline.html', destination: '/project/progress', permanent: true },
      { source: '/aipla/led-planck.html', destination: '/project/activities/led-planck', permanent: true },
      { source: '/aipla/kinebot.html', destination: '/project/activities/kinebot', permanent: true },
      { source: '/aipla/assets/examples/projectile-motion.html', destination: '/project/activities/boldkast', permanent: true },
      { source: '/aipla/assets/examples/led-planck-virtual-lab.html', destination: '/project/activities/led-planck', permanent: true },
      { source: '/aipla/assets/examples/kinebot-v2.html', destination: '/project/activities/kinebot', permanent: true },
    ]
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
      // MOBILE-1 — the service worker must never be served from cache. A stale
      // sw.js is self-perpetuating: the old worker keeps answering, so the new
      // one is never fetched, and the bug outlives every deploy until someone
      // clears site data by hand. Next serves /public with `private, max-age=0`
      // which would probably be enough; saying it explicitly costs nothing and
      // removes the "probably".
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          // Lets the worker claim the whole origin even though the script is
          // served from /public. Harmless at the root; load-bearing if the
          // script ever moves under a path.
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
