import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ---------------------------------------------------------------------------
// Intent detectors
// ---------------------------------------------------------------------------

function isOrderIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(order|buy|purchase|get me|deliver|delivery)\b/.test(t);
}

function isPresentationIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(ppt|pptx|powerpoint|presentation|pitch deck|deck|slides)\b/.test(t);
}

function isEmailIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(email|inbox|mailbox|gmail|outlook|office\s?365|o365|m365|read my mail|check mail)\b/.test(t);
}

function isPhotoIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(photo|image|pic|picture)\b/.test(t) && /\b(send|give|share|show)\b/.test(t);
}

function isResearchIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(research|find out|look up|investigate|what is|who is|how does|explain|tell me about|compare|analysis|analyse|analyze)\b/.test(t);
}

function isSoftwareIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(code|script|program|write (a |me a |some )?function|build (me |a )?app|deploy|debug|fix (the |this |my )?bug|github|repo)\b/.test(t);
}

function isFileIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(convert|create (a |me a )?(doc|pdf|word|excel|csv|spreadsheet)|download|export|upload|send (me |the |a )?file)\b/.test(t);
}

/** Catches any substantive task request not covered by specific intents. */
function isGenericTaskIntent(text: string): boolean {
  const t = text.toLowerCase();
  // Must look like an action request, not a pure question or greeting
  const actionWords = /\b(make|create|build|set up|setup|open|launch|start|run|generate|find|get|book|schedule|register|sign (me |us )?up|fill|submit|post|send|write|draft|search|check|show|list|help me|do|handle|manage|fix|update|change|edit|install|configure)\b/;
  const notJustChat = !/^(hi|hello|hey|thanks|ok|okay|sure|yes|no|what|who|when|where|why)\b/.test(t.trim());
  return actionWords.test(t) && notJustChat;
}

// ---------------------------------------------------------------------------
// Provider helpers (ordering)
// ---------------------------------------------------------------------------

function extractProvider(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("blinkit")) return "Blinkit";
  if (t.includes("zepto") || t.includes("zeppo")) return "Zepto";
  if (t.includes("instamart")) return "Swiggy Instamart";
  if (t.includes("swiggy")) return "Swiggy";
  if (t.includes("zomato")) return "Zomato";
  if (t.includes("bigbasket")) return "BigBasket";
  if (t.includes("amazon")) return "Amazon";
  if (t.includes("flipkart")) return "Flipkart";
  return null;
}

function inferProviderFromItem(text: string): string {
  const t = text.toLowerCase();
  // Groceries / quick-commerce
  if (/\b(grocery|groceries|vegetable|fruit|milk|bread|eggs|butter|rice|dal|atta|flour|sugar|salt|oil|water bottle|cold drink|coke|pepsi|juice|chips|biscuit|snack|ice cream|chocolate|coffee|tea|cigarette|beer|wine)\b/.test(t)) {
    return "Blinkit or Zepto (quick-commerce — fast delivery)";
  }
  // Food
  if (/\b(food|meal|dinner|lunch|breakfast|biryani|pizza|burger|sandwich|thali|rolls|noodles|pasta|kebab|momos|chinese|italian|sushi)\b/.test(t)) {
    return "Swiggy or Zomato (food delivery)";
  }
  // Electronics / general e-commerce
  if (/\b(phone|laptop|tablet|headphone|charger|cable|electronic|gadget|appliance)\b/.test(t)) {
    return "Amazon or Flipkart";
  }
  return "Blinkit (default quick-commerce)";
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

function genericTaskDirective(prompt: string): string {
  return [
    "[PLATFORM DIRECTIVE: AUTONOMOUS TASK EXECUTION]",
    "The user has given you a task. You are an autonomous operating concierge.",
    "Follow this loop before doing anything else:",
    "",
    "STEP 1 — REASON: What does the user actually need? What is the exact goal?",
    "STEP 2 — PLAN: What is the best way to achieve it? Options in priority order:",
    "  a) A website or app exists that can do this — open it in the browser and do it.",
    "  b) An API or CLI tool can do it — use it.",
    "  c) You can do it inline directly — do it.",
    "  → ALWAYS prefer browser automation (a) over inline answers for real-world tasks.",
    "STEP 3 — IDENTIFY BLOCKERS: Does the task need login? Credentials? Registration?",
    "  - Login with email+password: ask the user for credentials at the moment you need them.",
    "  - Login with phone+OTP: use the user's phone number automatically; call otp_request when OTP is needed.",
    "  - New account needed on a service: register with a temp email (open temp-mail.org first, copy the address, register, verify).",
    "STEP 4 — ACT: Start executing. Report each major step in one line. Don't wait for permission.",
    "STEP 5 — DELIVER: Send the result directly (file, confirmation, summary) via WhatsApp.",
    "",
    "Rules:",
    "- Never say 'I can't' without trying.",
    "- Never give the user a link and ask them to do it themselves.",
    "- Never claim a site is blocked without opening it and taking a snapshot first.",
    "- Stop and ask CONFIRM only before irreversible actions (payment, deletion, sending on their behalf).",
    "",
    `User request: ${prompt.trim()}`,
  ].join("\n");
}

function orderDirective(prompt: string): string {
  const provider = extractProvider(prompt);
  const inferredProvider = inferProviderFromItem(prompt);
  const providerLine = provider
    ? `Requested provider: ${provider}. Use it.`
    : `No provider specified. Based on the item, the best choice is: ${inferredProvider}. Pick the top option and proceed without asking unless there is a strong reason not to.`;

  return [
    "[PLATFORM DIRECTIVE: ORDER / DELIVERY FLOW]",
    "The user wants to order or buy something. Execute the full order flow autonomously.",
    "",
    "STEP 1 — REASON about the best provider:",
    providerLine,
    "Quick-commerce priority for groceries/drinks: Blinkit → Zepto → Instamart.",
    "Food delivery priority: Swiggy → Zomato.",
    "General e-commerce: Amazon → Flipkart.",
    "",
    "STEP 2 — Open the provider in the browser:",
    "  - First try: target=\"node\" profile=\"openclaw\" (user's machine, residential IP — best for anti-bot sites).",
    "  - If node unavailable or errors: fallback immediately to target=\"host\".",
    "  - Call browser action=open with the provider URL.",
    "",
    "STEP 3 — Search and add to cart:",
    "  - Search for the item.",
    "  - Pick the best match (consider price, rating, availability).",
    "  - Add to cart. Confirm selection with user only if variant is genuinely ambiguous.",
    "",
    "STEP 4 — Login / checkout:",
    "  - Use user's WhatsApp number as the phone number for OTP-based login.",
    "  - When OTP is needed: call otp_request immediately. Wait for user reply. Type the OTP in the browser. Continue.",
    "  - If the site needs email+password: ask the user 'What email and password should I use for [provider]?'",
    "",
    "STEP 5 — STOP before payment:",
    "  - Show the order summary: item, quantity, price, delivery time.",
    "  - Ask: 'Confirm this order? [item] from [provider] — ₹[price] — delivery in [ETA]'",
    "  - Only proceed after explicit user confirmation.",
    "  - Ask for payment details if not already saved.",
    "",
    "STEP 6 — Place order and confirm:",
    "  - Complete the order.",
    "  - Send confirmation: 'Order placed! [item] from [provider]. Order ID: [id]. ETA: [time].'",
    "",
    "If a provider blocks automation (Cloudflare/bot detection):",
    "  - Take a snapshot to confirm the block. Never guess.",
    "  - If user did not specify a provider: silently try the next best option.",
    "  - If user insisted on a specific provider: ask ONE question — 'Switch to [next provider], or run the browser on your machine (OpenClaw Node)?'",
    "",
    "Default assumptions (do not ask unless missing): quantity=1, login phone = user's WhatsApp number.",
    "Only ask ONE question at a time. Only ask what is actually needed right now.",
  ].join("\n");
}

function presentationDirective(prompt: string): string {
  return [
    "[PLATFORM DIRECTIVE: PRESENTATION / DECK FLOW]",
    "The user wants a presentation. Execute the full flow: find the best AI tool, generate, export, and deliver the file.",
    "",
    "STEP 1 — REASON: AI deck tools produce better slides faster than building from scratch.",
    "Priority order: Gamma (gamma.app) → Canva (canva.com) → Presentations.AI → SlidesAI.io",
    "",
    "STEP 2 — Start browser:",
    "  - target=\"node\" profile=\"openclaw\" first; if unavailable, fallback to target=\"host\".",
    "",
    "STEP 3 — Open Gamma (gamma.app):",
    "  - If sign-up is required and user has no account: register with a temporary email.",
    "    To get a temp email: open temp-mail.org in a new tab, copy the address, come back, register with it.",
    "    Check temp-mail.org inbox for verification email, click the link.",
    "  - Create a new presentation with the user's topic/brief.",
    "  - Wait for generation to complete (poll for loading indicator to disappear).",
    "",
    "STEP 4 — Export:",
    "  - Find the Export / Download button.",
    "  - Export as PPTX (or PDF if PPTX unavailable).",
    "  - If Gamma is blocked or fails: move to Canva, then Presentations.AI. Same temp-email approach if needed.",
    "",
    "STEP 5 — Deliver:",
    "  - Send the downloaded file to the user as WhatsApp media.",
    "  - Ask once: 'Want any changes — different theme, more slides, or specific branding?'",
    "",
    `Presentation topic/context: ${prompt.trim()}`,
  ].join("\n");
}

function emailDirective(prompt: string): string {
  return [
    "[PLATFORM DIRECTIVE: EMAIL FLOW]",
    "The user wants to interact with their email. Execute it via browser automation.",
    "",
    "STEP 1 — Gather minimal credentials (ask only what you don't have):",
    "  - Provider: Gmail, Outlook, Yahoo, or custom IMAP?",
    "  - Email address.",
    "  - Password (or app-password if 2FA is on).",
    "  Ask all of these in ONE message if none are known. Wait for reply before proceeding.",
    "",
    "STEP 2 — Open the email provider in the browser:",
    "  - target=\"node\" first, fallback to target=\"host\".",
    "  - Navigate to the login page.",
    "",
    "STEP 3 — Login:",
    "  - Fill email + password.",
    "  - If 2FA/OTP is required: call otp_request immediately. Wait. Fill the OTP. Continue.",
    "",
    "STEP 4 — Read / act:",
    "  - List the most recent 5–10 messages: from, subject, one-line summary.",
    "  - Ask what action the user wants (reply, delete, forward, etc.) if not already specified.",
    "",
    "If the provider blocks automation (CAPTCHA/Cloudflare): ask ONE choice — 'Run browser on your machine (OpenClaw Node) to bypass, or provide an app password?'",
    "",
    `User message: ${prompt.trim()}`,
  ].join("\n");
}

function researchDirective(prompt: string): string {
  return [
    "[PLATFORM DIRECTIVE: RESEARCH FLOW]",
    "The user wants information or research. Execute it with real tools — don't answer from memory alone.",
    "",
    "STEP 1 — Open Perplexity (perplexity.ai) in the browser for sourced, up-to-date research.",
    "  - target=\"node\" first, fallback to target=\"host\".",
    "  - Type the research query.",
    "  - Wait for the full answer to load.",
    "",
    "STEP 2 — Read and synthesize:",
    "  - Extract key facts, figures, and sources.",
    "  - If the answer is incomplete, follow the most relevant source link and read it.",
    "",
    "STEP 3 — Deliver:",
    "  - Send a concise summary (3–5 bullet points) with sources cited.",
    "  - Offer to dig deeper on any specific angle.",
    "",
    "For quick factual questions (definitions, conversions, simple math): answer inline, no browser needed.",
    `Research query: ${prompt.trim()}`,
  ].join("\n");
}

function softwareDirective(prompt: string): string {
  return [
    "[PLATFORM DIRECTIVE: SOFTWARE / CODE FLOW]",
    "The user wants code written, fixed, or deployed.",
    "",
    "STEP 1 — Assess scope:",
    "  - Small (single function, script, fix): solve inline and send the code directly.",
    "  - Medium (multiple files, a feature): use bash tools to create files, then send.",
    "  - Large (full project, app): use Claude Code CLI via bash tool.",
    "",
    "STEP 2 — Execute:",
    "  - Write clean, working code.",
    "  - Run it to verify if possible.",
    "  - If tests fail: debug and fix before delivering.",
    "",
    "STEP 3 — Deploy (only if user requested):",
    "  - STOP and ask: 'Ready to deploy to [target]. Confirm?'",
    "  - Only deploy after explicit confirmation.",
    "  - Send the live URL / confirmation after deployment.",
    "",
    "STEP 4 — Deliver:",
    "  - Send the code as a file (not just inline text) for anything over 30 lines.",
    "  - Include a 1–2 line explanation of what it does.",
    `Request: ${prompt.trim()}`,
  ].join("\n");
}

function fileDirective(prompt: string): string {
  return [
    "[PLATFORM DIRECTIVE: FILE / DOCUMENT FLOW]",
    "The user wants a file created, converted, or handled.",
    "",
    "STEP 1 — Identify the output format needed (PDF, Word, Excel, CSV, etc.).",
    "",
    "STEP 2 — Execute:",
    "  - Simple docs (text, simple tables): generate inline with bash tools (pandoc, python, etc.).",
    "  - Spreadsheets/complex docs: use a web tool via browser or generate with a script.",
    "  - File conversion: use bash tools (ffmpeg, pandoc, imagemagick, etc.) or open a conversion site in the browser.",
    "",
    "STEP 3 — Deliver:",
    "  - Send the actual file as WhatsApp media — never just a link or instructions.",
    `Request: ${prompt.trim()}`,
  ].join("\n");
}

function photoDirective(): string {
  return [
    "[PLATFORM DIRECTIVE: IMAGE / PHOTO FLOW]",
    "The user wants an image. Deliver it as actual WhatsApp media.",
    "",
    "For generic stock photos: use stock_photo_send tool directly.",
    "For AI-generated images:",
    "  - Try DALL-E API first if configured.",
    "  - Otherwise open Midjourney (midjourney.com) or Adobe Firefly (firefly.adobe.com) in the browser.",
    "  - Register with a temp email if no account exists.",
    "  - Generate the image, download it, send as WhatsApp media.",
    "",
    "NEVER send a link and ask the user to open it. Send the actual image.",
    "For requests involving real people: use stock photos only. Do not claim to generate photos of specific real individuals.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default {
  id: "intent-router-skill",
  name: "Intent Router",
  description: "Injects task-specific execution directives into the system prompt for tool-first autonomous behaviour.",
  register(api: OpenClawPluginApi) {
    api.on("before_prompt_build", (event, _ctx) => {
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      const directives: string[] = [];

      // Specific intents — inject detailed flow directives
      if (isOrderIntent(prompt)) {
        directives.push(orderDirective(prompt));
      }
      if (isPresentationIntent(prompt)) {
        directives.push(presentationDirective(prompt));
      }
      if (isEmailIntent(prompt)) {
        directives.push(emailDirective(prompt));
      }
      if (isPhotoIntent(prompt)) {
        directives.push(photoDirective());
      }
      if (isResearchIntent(prompt)) {
        directives.push(researchDirective(prompt));
      }
      if (isSoftwareIntent(prompt)) {
        directives.push(softwareDirective(prompt));
      }
      if (isFileIntent(prompt)) {
        directives.push(fileDirective(prompt));
      }

      // Generic task directive fires when no specific intent matched but the
      // message is clearly asking for something to be done.
      if (directives.length === 0 && isGenericTaskIntent(prompt)) {
        directives.push(genericTaskDirective(prompt));
      }

      if (directives.length === 0) {
        return;
      }

      return {
        // Appended into the system prompt by the OpenClaw fork patch.
        systemPrompt: directives.join("\n\n"),
      };
    });
  },
};
