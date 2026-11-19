/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // Nothing uses next/image. Unoptimised means Next never runs its image optimiser;
  // middleware.ts also answers /_next/image with a 404. See the note there.
  images: { unoptimized: true },
};
module.exports = nextConfig;
