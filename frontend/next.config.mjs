/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 将 /api/v1/* 代理到本地后端，前端同源访问，SSE 直通不缓冲。
  // 后端地址可用环境变量 BACKEND_ORIGIN 覆盖，默认 http://localhost:8000。
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backend}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
