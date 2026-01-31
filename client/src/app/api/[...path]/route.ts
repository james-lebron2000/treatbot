import { NextRequest, NextResponse } from 'next/server';

// ==============================================================================
// 🎯 API Proxy Route
// ==============================================================================
// Linus philosophy: Keep it simple, stupid.
// Proxy all /api/* requests to backend server
// ==============================================================================

export const runtime = 'nodejs';

function resolveTargetBaseUrl() {
  // Docker/K8s: set API_PROXY_TARGET=http://backend:5001/api
  const envTarget = process.env.API_PROXY_TARGET || process.env.INTERNAL_API_BASE_URL;
  if (envTarget && /^https?:\/\//i.test(envTarget)) {
    return envTarget.replace(/\/$/, '');
  }
  // Local dev fallback
  return 'http://localhost:5001/api';
}

function buildTargetUrl(pathSegments: string[]) {
  const base = resolveTargetBaseUrl();
  const suffix = (pathSegments || []).map((p) => encodeURIComponent(p)).join('/');
  return `${base}/${suffix}`;
}

function filterHopByHopHeaders(headers: Headers) {
  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length'
  ]);
  const out = new Headers();
  headers.forEach((value, key) => {
    if (hopByHop.has(key.toLowerCase())) return;
    out.set(key, value);
  });
  return out;
}

async function proxy(request: NextRequest, pathSegments: string[]) {
  const targetUrl = `${buildTargetUrl(pathSegments)}${request.nextUrl.search || ''}`;

  try {
    const headers = filterHopByHopHeaders(request.headers);

    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      redirect: 'manual'
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    const upstream = await fetch(targetUrl, init);

    const responseHeaders = filterHopByHopHeaders(upstream.headers);
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error('API proxy error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path);
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
