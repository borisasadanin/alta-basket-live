/**
 * Cloudflare Worker — proxies /c/<clipId> to the backend OG route.
 *
 * Setup in Cloudflare Dashboard:
 * 1. Workers & Pages → Create → "Create Worker"
 * 2. Name: "alta-clip-share"
 * 3. Paste this code → Deploy
 * 4. Go to altacourtside.se domain → Workers Routes
 * 5. Add route: altacourtside.se/c/* → alta-clip-share
 */

const BACKEND = "https://borispriv-altabasketapi.eyevinn-web-runner.auto.prod-se.osaas.io";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/c\/([^/]+)$/);

    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const clipId = match[1];

    // Forward the request to the backend OG route (preserve user-agent for bot detection)
    const backendUrl = `${BACKEND}/api/clips/${encodeURIComponent(clipId)}/og`;
    const res = await fetch(backendUrl, {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "",
      },
    });

    // Return the response with the correct content type
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "text/html",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};
