import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const MediaSendUrlSchema = Type.Object({
  to: Type.String({ description: "WhatsApp number to send to (E.164)." }),
  url: Type.String({ description: "Remote media URL (http/https)." }),
  caption: Type.Optional(Type.String({ description: "Caption to include with the media." })),
  filename: Type.Optional(Type.String({ description: "Optional filename override (no path)." })),
  maxBytes: Type.Optional(
    Type.Number({
      description: "Max bytes to download (default 15MB).",
      minimum: 1024,
      maximum: 50 * 1024 * 1024,
    }),
  ),
  accountId: Type.Optional(Type.String({ description: "WhatsApp account id override." })),
});

const StockPhotoSendSchema = Type.Object({
  to: Type.String({ description: "WhatsApp number to send to (E.164)." }),
  query: Type.String({
    description:
      'Search keywords (e.g. "indian woman portrait"). This tool uses a stock-photo provider.',
  }),
  caption: Type.Optional(Type.String({ description: "Caption to include with the photo." })),
  width: Type.Optional(Type.Number({ description: "Requested width in px (default 1600).", minimum: 256, maximum: 4096 })),
  height: Type.Optional(Type.Number({ description: "Requested height in px (default 900).", minimum: 256, maximum: 4096 })),
  accountId: Type.Optional(Type.String({ description: "WhatsApp account id override." })),
});

function assertHttpUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`invalid url: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`url must be http/https: ${input}`);
  }
  return url.toString();
}

function safeBasename(name: string): string {
  const base = path.basename(name);
  // Basic sanitization: strip path-y chars and collapse whitespace.
  return base.replace(/[^\w.\-()+ ]+/g, "_").trim().replace(/\s+/g, " ");
}

function extFromContentType(contentType: string | null): string {
  const ct = String(contentType || "").split(";")[0]?.trim().toLowerCase();
  if (ct === "image/jpeg") return ".jpg";
  if (ct === "image/png") return ".png";
  if (ct === "image/webp") return ".webp";
  if (ct === "image/gif") return ".gif";
  return "";
}

async function downloadToFile(opts: {
  url: string;
  dir: string;
  filename?: string;
  maxBytes: number;
}): Promise<{ filePath: string; bytes: number; contentType: string | null; finalUrl: string }> {
  await fs.promises.mkdir(opts.dir, { recursive: true });

  const res = await fetch(opts.url, {
    redirect: "follow",
    headers: {
      // Some CDNs reject "node" user agents; be slightly more browser-like.
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type");
  const ext = extFromContentType(contentType);
  if (ext && !ext.startsWith(".")) {
    throw new Error("invalid content-type mapping");
  }
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`unsupported content-type: ${contentType}`);
  }

  const filenameBase = opts.filename ? safeBasename(opts.filename) : `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const finalName = path.extname(filenameBase) ? filenameBase : `${filenameBase}${ext || ".jpg"}`;
  const filePath = path.join(opts.dir, finalName);

  const body = res.body;
  if (!body) {
    throw new Error("download failed: empty body");
  }

  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      bytes += (chunk as Buffer).length;
      if (bytes > opts.maxBytes) {
        cb(new Error(`download exceeded maxBytes (${opts.maxBytes})`));
        return;
      }
      cb(null, chunk);
    },
  });

  const nodeReadable = Readable.fromWeb(body as any);
  const out = fs.createWriteStream(filePath, { flags: "w" });
  try {
    await pipeline(nodeReadable, limiter, out);
  } catch (err) {
    try {
      await fs.promises.rm(filePath, { force: true });
    } catch {
      // ignore
    }
    throw err;
  }

  return { filePath, bytes, contentType, finalUrl: res.url || opts.url };
}

function unsplashSourceUrl(query: string, width: number, height: number): string {
  const keywords = query
    .split(/[,]+|\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const q = keywords.join(",");
  return `https://source.unsplash.com/${width}x${height}/?${encodeURIComponent(q)}`;
}

async function findCommonsImageUrl(query: string): Promise<string | null> {
  const searchUrl = new URL("https://commons.wikimedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", query);
  searchUrl.searchParams.set("srnamespace", "6"); // File:
  searchUrl.searchParams.set("srlimit", "5");
  searchUrl.searchParams.set("format", "json");

  const searchRes = await fetch(searchUrl.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "application/json",
    },
  });
  if (!searchRes.ok) return null;
  const searchJson = (await searchRes.json().catch(() => null)) as any;
  const results: Array<{ title?: string }> = searchJson?.query?.search || [];
  const titles = results
    .map((r) => (typeof r?.title === "string" ? r.title : ""))
    .filter(Boolean)
    .slice(0, 5);
  if (titles.length === 0) return null;

  const infoUrl = new URL("https://commons.wikimedia.org/w/api.php");
  infoUrl.searchParams.set("action", "query");
  infoUrl.searchParams.set("prop", "imageinfo");
  infoUrl.searchParams.set("iiprop", "url|mime");
  infoUrl.searchParams.set("titles", titles.join("|"));
  infoUrl.searchParams.set("format", "json");

  const infoRes = await fetch(infoUrl.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "application/json",
    },
  });
  if (!infoRes.ok) return null;
  const infoJson = (await infoRes.json().catch(() => null)) as any;
  const pages = infoJson?.query?.pages || {};
  for (const key of Object.keys(pages)) {
    const page = pages[key];
    const ii = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
    const url = typeof ii?.url === "string" ? ii.url : "";
    const mime = typeof ii?.mime === "string" ? ii.mime : "";
    // Avoid svg/tiff and other weird formats for WhatsApp.
    if (!url) continue;
    if (mime && !mime.toLowerCase().startsWith("image/")) continue;
    if (url.toLowerCase().endsWith(".svg") || url.toLowerCase().endsWith(".tif") || url.toLowerCase().endsWith(".tiff")) {
      continue;
    }
    return url;
  }
  return null;
}

export default {
  id: "media-send-skill",
  name: "Media Sender",
  description: "Download remote images and send them via WhatsApp.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "media_send_url",
      label: "Media Send URL",
      description: "Download an image from a URL and send it via WhatsApp as media (not just a link).",
      parameters: MediaSendUrlSchema,
      async execute(_toolCallId: string, params: any) {
        const to = typeof params.to === "string" ? params.to.trim() : "";
        const url = typeof params.url === "string" ? params.url.trim() : "";
        if (!to) throw new Error("to required");
        if (!url) throw new Error("url required");

        const normalizedUrl = assertHttpUrl(url);
        const caption = typeof params.caption === "string" ? params.caption : "";
        const maxBytes =
          typeof params.maxBytes === "number" && Number.isFinite(params.maxBytes)
            ? Math.floor(params.maxBytes)
            : 15 * 1024 * 1024;

        const tmpRoot = process.env.OPENCLAW_STATE_DIR?.trim() || "/tmp";
        const dir = path.join(tmpRoot, "tmp-media");
        const { filePath, bytes, finalUrl } = await downloadToFile({
          url: normalizedUrl,
          dir,
          filename: typeof params.filename === "string" ? params.filename : undefined,
          maxBytes,
        });

        await api.runtime.channel.whatsapp.sendMessageWhatsApp(to, caption, {
          verbose: false,
          mediaUrl: filePath,
          mediaLocalRoots: [path.dirname(filePath)],
          accountId: typeof params.accountId === "string" ? params.accountId : undefined,
        });

        return {
          content: [{ type: "text", text: `Media sent to ${to}.` }],
          details: { filePath, bytes, sourceUrl: finalUrl },
        };
      },
    });

    api.registerTool({
      name: "stock_photo_send",
      label: "Stock Photo Send",
      description:
        "Fetch a stock photo matching a query and send it via WhatsApp as an actual image. Uses Unsplash Source (no API key).",
      parameters: StockPhotoSendSchema,
      async execute(_toolCallId: string, params: any) {
        const to = typeof params.to === "string" ? params.to.trim() : "";
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!to) throw new Error("to required");
        if (!query) throw new Error("query required");

        const width =
          typeof params.width === "number" && Number.isFinite(params.width) ? Math.floor(params.width) : 1600;
        const height =
          typeof params.height === "number" && Number.isFinite(params.height) ? Math.floor(params.height) : 900;
        let url = unsplashSourceUrl(query, width, height);

        const caption =
          typeof params.caption === "string" && params.caption.trim()
            ? params.caption.trim()
            : `Stock photo for: ${query}\nSource: Unsplash`;

        const tmpRoot = process.env.OPENCLAW_STATE_DIR?.trim() || "/tmp";
        const dir = path.join(tmpRoot, "tmp-media");
        let downloaded: { filePath: string; bytes: number; finalUrl: string; provider: string } | null = null;
        try {
          const { filePath, bytes, finalUrl } = await downloadToFile({
            url,
            dir,
            filename: `stock-${query.slice(0, 40).replace(/\s+/g, "-")}.jpg`,
            maxBytes: 15 * 1024 * 1024,
          });
          downloaded = { filePath, bytes, finalUrl, provider: "unsplash-source" };
        } catch (err) {
          // Unsplash Source can occasionally 503 from some networks. Fall back to Commons.
          const commonsUrl = await findCommonsImageUrl(query);
          if (!commonsUrl) {
            throw err;
          }
          url = commonsUrl;
          const { filePath, bytes, finalUrl } = await downloadToFile({
            url,
            dir,
            filename: `commons-${query.slice(0, 40).replace(/\s+/g, "-")}.jpg`,
            maxBytes: 15 * 1024 * 1024,
          });
          downloaded = { filePath, bytes, finalUrl, provider: "wikimedia-commons" };
        }

        await api.runtime.channel.whatsapp.sendMessageWhatsApp(to, caption, {
          verbose: false,
          mediaUrl: downloaded.filePath,
          mediaLocalRoots: [path.dirname(downloaded.filePath)],
          accountId: typeof params.accountId === "string" ? params.accountId : undefined,
        });

        return {
          content: [{ type: "text", text: `Stock photo sent to ${to}.` }],
          details: {
            filePath: downloaded.filePath,
            bytes: downloaded.bytes,
            sourceUrl: downloaded.finalUrl,
            provider: downloaded.provider,
          },
        };
      },
    });
  },
};
