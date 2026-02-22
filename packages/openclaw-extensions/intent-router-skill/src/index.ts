import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

function isOrderIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(order|buy|purchase|get me)\b/.test(t)) return false;
  // If the user provides a provider explicitly, we should be confident.
  if (/\b(blinkit|zepto|instamart|swiggy|zomato|bigbasket|amazon)\b/.test(t)) return true;
  // Otherwise still treat as an order request, but we'll ask provider as the single question.
  return true;
}

function extractProvider(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("blinkit")) return "Blinkit";
  if (t.includes("zepto") || t.includes("zeppo")) return "Zepto";
  if (t.includes("instamart")) return "Swiggy Instamart";
  if (t.includes("swiggy")) return "Swiggy";
  if (t.includes("zomato")) return "Zomato";
  if (t.includes("bigbasket")) return "BigBasket";
  if (t.includes("amazon")) return "Amazon";
  return null;
}

function orderDirective(prompt: string): string {
  const provider = extractProvider(prompt);
  const providerLine = provider ? `Provider requested: ${provider}. Use it.` : "Provider not specified: ask ONE question for preferred provider (Blinkit/Zepto/Instamart/etc).";
  return [
    "[PLATFORM DIRECTIVE: ORDER FLOW]",
    "The user is requesting an order/purchase. You are an operating concierge with browser automation.",
    "Assume browser automation is available in this environment. Do not instruct the user to run OpenClaw config commands; just try the browser flow first.",
    "Do NOT reply with 'I don't have access' or ask for permission to try. Begin the flow immediately.",
    providerLine,
    "Default assumptions (unless user overrides): login phone == the sender's WhatsApp number; quantity=1; address/pincode from the message or user profile.",
    "If delivery area/pincode is missing, ask only for that (single question). If variant/qty is ambiguous, ask a single disambiguation question.",
    "Proceed in the browser now (tool-first):",
    "- First try: Call `browser` action=start with target=\"node\" profile=\"openclaw\" (runs browser on the user's machine/network).",
    "- If that errors (no node / not paired): immediately retry with `browser` action=start target=\"host\" profile=\"openclaw\" (runs browser in the server/container).",
    "- Call `browser` action=open with targetUrl set to the provider site (or search page if appropriate).",
    "- Use `browser` action=snapshot and `browser` action=act to navigate and add items to cart.",
    "- Do not claim a provider is blocking automation unless you have actually opened the site and captured a snapshot showing the block (e.g., Cloudflare / access denied).",
    "- Never invent HTTP status codes, IP addresses, or provider errors. Only report what you can observe from tool output/screenshots.",
    "If login requires OTP to the user's phone, request it using tool `otp_request` and wait; then continue.",
    "Stop before placing the order/payment and ask for explicit confirmation (CONFIRM).",
    "If the provider blocks automation (Cloudflare / Access denied / bot protection), do NOT give up immediately:",
    "- First: try the next best provider (Zepto -> Instamart -> BigBasket -> Amazon) if the user did not explicitly insist on a specific provider.",
    "- If the user insisted (e.g. Blinkit): ask ONE question: 'Blinkit is blocking server automation. Want me to (1) switch provider, or (2) run the browser on your machine via an OpenClaw Node so Blinkit works?'",
    "- Use `stuck_escalate` for the single-question handoff and wait for the answer.",
  ].join("\n");
}

function isPhotoIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(photo|image|pic|picture)\b/.test(t) && /\b(send|give|share)\b/.test(t);
}

function isPresentationIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(ppt|pptx|powerpoint|presentation|pitch deck|deck|slides)\b/.test(t);
}

function presentationDirective(prompt: string): string {
  const topic = prompt.trim();
  return [
    "[PLATFORM DIRECTIVE: PRESENTATION FLOW]",
    "The user is requesting a presentation/deck. You are an operating concierge and should deliver an actual PPTX attachment (not just an outline).",
    "Approach selection:",
    "- Default: generate a PPTX locally using tool `deck_send_pptx` (fast, deterministic).",
    "- If the user explicitly asks for Gamma/Canva: use browser automation + those tools, then download and send the PPTX.",
    "Process:",
    "- Draft a concise slide plan (8–12 slides) for the topic, then immediately call `deck_send_pptx` with title + slides + bullets.",
    "- After sending, ask one follow-up question (optional): 'Want a different theme, more slides, or include company-specific content?'",
    `Topic/context (user message): ${topic}`,
  ].join("\n");
}

function photoDirective(): string {
  return [
    "[PLATFORM DIRECTIVE: MEDIA FLOW]",
    "If the user wants an image 'as a photo', send real WhatsApp media (not just links).",
    "Use tool `stock_photo_send` for generic stock photos, or `media_send_url` when you have a direct image URL.",
    "Do not claim you can't provide photos of people when it is clearly a generic stock image request.",
    "If a request includes an age (e.g. '24 years old'), do not assert age; just send a suitable stock photo and note you can't verify age from a photo.",
  ].join("\n");
}

export default {
  id: "intent-router-skill",
  name: "Intent Router",
  description: "Prompt injection router to make tool-first behavior reliable.",
  register(api: OpenClawPluginApi) {
    api.on("before_prompt_build", (event, _ctx) => {
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      const directives: string[] = [];
      if (isOrderIntent(prompt)) {
        directives.push(orderDirective(prompt));
      }
      if (isPresentationIntent(prompt)) {
        directives.push(presentationDirective(prompt));
      }
      if (isPhotoIntent(prompt)) {
        directives.push(photoDirective());
      }
      if (directives.length === 0) {
        return;
      }
      return {
        // This is appended into the *system prompt* by our OpenClaw fork patch.
        // Do NOT put these directives into the user prompt (models may treat it as prompt-injection).
        systemPrompt: directives.join("\n\n"),
      };
    });
  },
};
