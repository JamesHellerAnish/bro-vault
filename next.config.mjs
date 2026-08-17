/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deliberately NOT setting eslint.ignoreDuringBuilds or typescript.ignoreBuildErrors.
  // fe-gmq sets both, which ships type errors to production (PLAN.md section 13). This app
  // holds client PII, health hints and premium figures -- the build stays honest.
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Supabase Storage, for broker avatars and (later) lead documents.
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
}

export default nextConfig
