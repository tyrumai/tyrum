/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    dirs: ["app"],
  },
  experimental: {
    reactCompiler: false,
  },
};

export default nextConfig;
