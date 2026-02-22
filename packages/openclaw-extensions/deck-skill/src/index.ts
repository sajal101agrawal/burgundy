import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// NOTE: This skill relies on `pptxgenjs` being available in the OpenClaw runtime image.
// We install it in the OpenClaw fork container layer (see Dockerfile changes).
// eslint-disable-next-line import/no-extraneous-dependencies
import pptxgenjs from "pptxgenjs";

const SlideSchema = Type.Object({
  title: Type.String({ description: "Slide title." }),
  bullets: Type.Optional(Type.Array(Type.String({ description: "Bullet point text." }))),
  notes: Type.Optional(Type.String({ description: "Optional speaker notes." })),
});

const DeckSendSchema = Type.Object({
  to: Type.String({ description: "WhatsApp number to send to (E.164)." }),
  title: Type.String({ description: "Deck title." }),
  subtitle: Type.Optional(Type.String({ description: "Optional subtitle." })),
  slides: Type.Array(SlideSchema, { description: "Slides (excluding title slide is allowed)." }),
  filename: Type.Optional(Type.String({ description: "Optional filename (no path)." })),
  accountId: Type.Optional(Type.String({ description: "WhatsApp account id override." })),
});

function safeFilename(name: string): string {
  const base = path.basename(name);
  const cleaned = base.replace(/[^\w.\-()+ ]+/g, "_").trim().replace(/\s+/g, " ");
  if (!cleaned.toLowerCase().endsWith(".pptx")) {
    return `${cleaned}.pptx`;
  }
  return cleaned;
}

function coerceSlides(raw: unknown): Array<{ title: string; bullets: string[]; notes?: string }> {
  const slides = Array.isArray(raw) ? raw : [];
  const out: Array<{ title: string; bullets: string[]; notes?: string }> = [];
  for (const s of slides) {
    if (!s || typeof s !== "object") continue;
    const title = typeof (s as any).title === "string" ? (s as any).title.trim() : "";
    if (!title) continue;
    const bulletsRaw = Array.isArray((s as any).bullets) ? (s as any).bullets : [];
    const bullets = bulletsRaw
      .map((b: any) => (typeof b === "string" ? b.trim() : ""))
      .filter((b: string) => b.length > 0)
      .slice(0, 10);
    const notes = typeof (s as any).notes === "string" ? (s as any).notes.trim() : undefined;
    out.push({ title, bullets, ...(notes ? { notes } : {}) });
  }
  return out;
}

export default {
  id: "deck-skill",
  name: "Deck Skill",
  description: "Generate PPTX decks and send them as WhatsApp documents.",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "deck_send_pptx",
      label: "Deck Send PPTX",
      description: "Generate a PPTX file from an outline and send it to the user via WhatsApp as an attachment.",
      parameters: DeckSendSchema,
      async execute(_toolCallId: string, params: any) {
        const to = typeof params.to === "string" ? params.to.trim() : "";
        const title = typeof params.title === "string" ? params.title.trim() : "";
        if (!to) throw new Error("to required");
        if (!title) throw new Error("title required");

        const subtitle = typeof params.subtitle === "string" ? params.subtitle.trim() : "";
        const slides = coerceSlides(params.slides);
        if (slides.length === 0) {
          throw new Error("slides required (at least 1)");
        }

        // `pptxgenjs` ships as CJS; under NodeNext + ESM the TS type sometimes doesn't
        // surface a construct signature cleanly, so we treat it as a constructor.
        const PptxCtor = pptxgenjs as unknown as { new (): any };
        const pptx = new PptxCtor();
        // 16:9 by default
        pptx.layout = "LAYOUT_WIDE";

        // Title slide
        {
          const slide = pptx.addSlide();
          slide.background = { color: "0F1A1A" };
          slide.addText(title, {
            x: 0.7,
            y: 1.3,
            w: 12,
            h: 1,
            fontFace: "Aptos Display",
            fontSize: 44,
            bold: true,
            color: "F2B880",
          });
          if (subtitle) {
            slide.addText(subtitle, {
              x: 0.7,
              y: 2.5,
              w: 12,
              h: 0.7,
              fontFace: "Aptos",
              fontSize: 20,
              color: "B6C4C1",
            });
          }
        }

        for (const s of slides) {
          const slide = pptx.addSlide();
          slide.background = { color: "142B2B" };
          slide.addText(s.title, {
            x: 0.7,
            y: 0.5,
            w: 12.5,
            h: 0.6,
            fontFace: "Aptos Display",
            fontSize: 30,
            bold: true,
            color: "6DD3B0",
          });

          const bulletLines = s.bullets.length > 0 ? s.bullets : ["(content coming soon)"];
          slide.addText(
            bulletLines.map((t) => `• ${t}`).join("\n"),
            {
              x: 1.0,
              y: 1.4,
              w: 11.8,
              h: 5.3,
              fontFace: "Aptos",
              fontSize: 18,
              color: "F5F2ED",
              valign: "top",
            },
          );

          if (s.notes) {
            // PptxGenJS supports speaker notes with `addNotes` on slide in newer versions.
            // Keep it best-effort (no hard failure if missing).
            (slide as any).addNotes?.(s.notes);
          }
        }

        const tmpRoot = process.env.OPENCLAW_STATE_DIR?.trim() || "/tmp";
        const outDir = path.join(tmpRoot, "tmp-media");
        await fs.promises.mkdir(outDir, { recursive: true });
        const filename =
          typeof params.filename === "string" && params.filename.trim()
            ? safeFilename(params.filename.trim())
            : safeFilename(`${Date.now()}-${randomUUID().slice(0, 8)}-${title.slice(0, 32)}`);
        const filePath = path.join(outDir, filename);

        await pptx.writeFile({ fileName: filePath });

        const caption = `📎 PPTX: ${title}`;
        await api.runtime.channel.whatsapp.sendMessageWhatsApp(to, caption, {
          verbose: false,
          mediaUrl: filePath,
          mediaLocalRoots: [outDir],
          accountId: typeof params.accountId === "string" ? params.accountId : undefined,
        });

        return {
          content: [{ type: "text", text: `Deck sent to ${to}.` }],
          details: { filePath, filename, slideCount: slides.length + 1 },
        };
      },
    });
  },
};
