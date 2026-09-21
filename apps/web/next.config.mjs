/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript-compiled CJS; Next transpiles them so the
  // web app and the API stay on exactly the same domain code.
  transpilePackages: [
    '@cerquita/api-client',
    '@cerquita/design-tokens',
    '@cerquita/types',
    '@cerquita/utils',
  ],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
  },
};

export default nextConfig;
