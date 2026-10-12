import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type ResearchOutput = {
  company: string;
  verifiedWebsite: string | null;
  question: string;
  thesis: string;
  decision: string;
  evidence: { title: string; url: string }[];
  confidence: "high" | "medium" | "low";
  caveat: string;
};

function takeText(response: any): string {
  return (response.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text")
    .map((part: any) => part.text ?? "")
    .join("");
}

function validUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try { return ["https:", "http:"].includes(new URL(url).protocol); }
  catch { return false; }
}

export async function POST(request: NextRequest) {
  // Deliberately disabled until Lee approves live traffic and API spend.
  if (process.env.RESEARCH_LAB_ENABLED !== "true") {
    return NextResponse.json({ error: "The research lab is not enabled." }, { status: 503 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "API credentials have not been configured." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const company = typeof body?.company === "string" ? body.company.trim() : "";
  const website = typeof body?.website === "string" ? body.website.trim() : "";
  if (company.length < 3 || company.length > 120 || website.length > 200 ||
      (website && !validUrl(website))) {
    return NextResponse.json({ error: "Enter a company name (3–120 characters) and optionally a valid website URL." }, { status: 400 });
  }

  const instructions = `You are StoneComms' evidence-led research opportunity analyst. Using public web research, identify the exact company before suggesting a commercially valuable and independently commissionable research question. The goal is a specific decision-useful issue relevant to its strategy, markets, investment, customers or institutional position, with a preference for African infrastructure, energy, investment and development where genuinely relevant. Do not pretend to know the company's internal priorities. Never make up reports, facts, sources, URLs or executives. If company identity is ambiguous, evidence is insufficient, or no plausible paid research need can be established, set confidence "low" and explain the limitation. Distinguish published facts from your inference. Return ONLY a JSON object with fields company, verifiedWebsite (string or null), question, thesis (max 90 words), decision (max 30 words), evidence (array of 1-3 {title,url} public source links), confidence ("high"|"medium"|"low"), caveat. Prefer evidence from the company's own reporting and reliable sector sources; cite genuine URLs that you checked. No markdown.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.RESEARCH_LAB_MODEL || "gpt-5-mini",
        tools: [{ type: "web_search" }],
        instructions,
        input: `Organisation: ${company}\nCompany website supplied by visitor: ${website || "(not supplied)"}`,
        max_output_tokens: 800
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      return NextResponse.json({ error: "The research service is temporarily unavailable." }, { status: 502 });
    }
    const data = await response.json();
    const raw = takeText(data);
    const output = JSON.parse(raw.replace(/^\`\`\`(?:json)?\s*|\s*\`\`\`$/g, "")) as ResearchOutput;
    if (!output || typeof output.question !== "string" || typeof output.thesis !== "string" ||
        typeof output.company !== "string" || !Array.isArray(output.evidence)) throw Error("Invalid model response");
    output.evidence = output.evidence.filter(x => x && typeof x.title === "string" && validUrl(x.url)).slice(0, 3);
    if (!output.evidence.length) output.confidence = "low";
    // Avoid showing a persuasive unsupported thesis as a confirmed finding.
    return NextResponse.json({ ...output, previewOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "We could not produce a reliable research question. Please try again later." }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
