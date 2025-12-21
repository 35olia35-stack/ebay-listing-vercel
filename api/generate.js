import 'dotenv/config';


// --- helpers ---
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSpaces = (s) =>
  String(s || '').trim().replace(/\s+/g, ' ');

// Title Case ТОЛЬКО для полностью lowercase ввода
// (без toLowerCase — запрещено)
const toTitleCaseFromAllLower = (s) => {
  return normalizeSpaces(s)
    .split(' ')
    .map(w => (w ? (w[0].toUpperCase() + w.slice(1)) : ''))
    .join(' ');
};

// Канонизация бренда без “убийства” заглавных
const canonicalizeBrand = (raw) => {
  const cleaned = normalizeSpaces(raw);
  if (!cleaned) return '';

  const hasUpper = /[A-Z]/.test(cleaned);
  const hasLower = /[a-z]/.test(cleaned);

  if (hasUpper) return cleaned;
  if (hasLower && !hasUpper) return toTitleCaseFromAllLower(cleaned);

  return cleaned;
};

// Делает паттерн бренда
const buildBrandRegex = (brandRaw) => {
  const cleaned = normalizeSpaces(brandRaw);
  if (!cleaned) return null;

  const core = escapeRegex(cleaned).replace(/\s+/g, '\\s+');
  const pattern = `(^|[^A-Za-z0-9])(${core})(?:'s|’s|s)?(?![A-Za-z0-9])`;
  return new RegExp(pattern, 'gim');
};

// Безопасная замена
const replaceBrandEverywhere = (obj, brandRaw, canonicalBrand) => {
  const rx = buildBrandRegex(brandRaw);
  if (!rx) return;

  for (const key in obj) {
    if (typeof obj[key] === 'string' && obj[key]) {
      obj[key] = obj[key].replace(rx, (_, left) => `${left}${canonicalBrand}`);
    }
  }
};

// Жёсткий финальный пост-проход
const forceBrandCanonicalEverywhere = (generatedObj, canonicalBrand) => {
  if (!canonicalBrand) return generatedObj;

  const rx = buildBrandRegex(canonicalBrand);
  if (!rx) return generatedObj;

  const walk = (v) => {
    if (typeof v === 'string' && v) {
      return v.replace(rx, (_, left) => `${left}${canonicalBrand}`);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      for (const k in v) v[k] = walk(v[k]);
      return v;
    }
    return v;
  };

  return walk(generatedObj);
};

// Classic mainText
const buildClassicMainText = (generated) => {
  const parts = [
    generated?.description_paragraph_1,
    generated?.description_paragraph_2,
    generated?.description_paragraph_3
  ].map(s => String(s || '').trim()).filter(Boolean);

  return parts.join('\n\n');
};

// --- API ---
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      tpl,

      // aiInput
      category,
      mainText,
      brand,
      condition,
      model,
      material,
      color,
      features,

      // facts
      handling_time,
      ships_from,
      estimated_delivery
    } = req.body || {};

    const canonicalBrand = canonicalizeBrand(brand);

    const systemPrompt = `
You are a professional e-commerce listing generator,
specialized in eBay-style product listings.

You MUST return ONLY valid JSON.
No markdown.
No explanations.
No additional text.

Use the exact keys provided.
Do not add new keys.
Do not remove keys.
Do not reorder keys.
If some information is missing, return an empty string for that field.

The output language must be English.
The tone must be professional, clear, and sales-oriented.
Avoid emojis, exclamation marks, and marketing fluff.

Content requirements:

- Title must be no longer than 80 characters.
- Title should start with the main product type when possible.
- The Title MUST include the brand name exactly as provided (canonical form below).
- Do not modify, abbreviate, translate, or paraphrase the brand name.
- Use the canonical brand name consistently in the Title and throughout the description.

Brand name consistency rule (strict, overriding):

- The brand name has a single canonical form (provided below).
- This canonical brand name MUST be used verbatim in all generated text fields.
- If the brand name appears in any other capitalization, spelling, or form
  (including from user-provided description text),
  it MUST be corrected to the canonical form.
- Never output the brand name in lowercase, uppercase, pluralized, abbreviated,
  possessive, or otherwise modified form (use exactly the canonical form).

- The main description must never be a single long paragraph.
- The main description MUST be formatted as multiple paragraphs.
- Separate paragraphs using a blank line (double line break).
- Never return the main description as a single paragraph.

- The field "mainText" represents the main description.
- The mainText field MUST be formatted as 2–4 paragraphs.
- Each paragraph in mainText MUST be separated by a blank line (double line break).
- Never return mainText as a single paragraph or a single block of text.
- Do not use bullet points or lists in mainText.

- Do not repeat the Title wording in the Subtitle.
- Always generate a short Subtitle (8–12 words) unless it would repeat the Title.
- Format the Subtitle in Title Case.
- Capitalize all major words in the Subtitle.
- Do not capitalize short function words (e.g. and, or, of, in, to, for, with) unless they are the first or last word.

SEO content requirements:

SEO description paragraphs must be substantial and informative.

Each seo_description_paragraph must:
- contain at least 2–3 full sentences
- expand on product features, benefits, or usage context
- avoid short, generic, or placeholder-style statements

SEO paragraphs must not be shorter than the Modern description paragraphs.

Content quality and density rules:

Do NOT reduce overall text length.
Do NOT compress paragraphs into fewer sentences.

Maintain the current paragraph structure and overall volume,
but increase informational density within each paragraph.

Avoid vague or filler adjectives such as "great", "excellent", "perfect", or "high-quality".
Replace them with concrete, descriptive language based on actual product attributes.

Do not repeat identical wording or sentence structures across different fields.
If the same idea appears in multiple sections, rephrase it naturally.

Maintain a confident, informative tone.
Avoid exaggerated, promotional, or hype language.

Do not introduce implied benefits, use cases, or scenarios
unless they are directly supported by the provided input data.

Return the result strictly in the following JSON format:

{
  "Title": "",
  "Subtitle": "",

  "seo_opening_paragraph": "",
  "seo_description_paragraph_1": "",
  "seo_description_paragraph_2": "",
  "seo_description_paragraph_3": "",
  "seo_long_tail_paragraph": "",

  "highlight_1": "",
  "highlight_2": "",
  "highlight_3": "",
  "highlight_4": "",

  "description_paragraph_1": "",
  "description_paragraph_2": "",
  "description_paragraph_3": ""
}
`;

    const userPrompt = `
Generate an e-commerce product listing using the data below.

Category:
${category || ""}

User description:
${mainText || ""}

Structured data (authoritative):
Brand (canonical): ${canonicalBrand || ""}
Condition: ${condition || ""}
Model: ${model || ""}
Material: ${material || ""}
Color: ${color || ""}
Features: ${features || ""}

Data priority rules:
- Structured fields are authoritative.
- If there is any conflict, trust structured fields.
- The user description is supplementary.
`;

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing in env" });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(500).json({ error: "OpenAI API error", details: errText });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let generated;
    try {
      generated = JSON.parse(content);
    } catch {
      return res.status(500).json({ error: "Model returned non-JSON", raw: content });
    }

    // --- canonical brand enforcement ---
    if (canonicalBrand) {
      replaceBrandEverywhere(generated, brand, canonicalBrand);
      replaceBrandEverywhere(generated, canonicalBrand, canonicalBrand);
      generated = forceBrandCanonicalEverywhere(generated, canonicalBrand);
    }

    // Classic mainText
    if (!generated.mainText) {
      generated.mainText = buildClassicMainText(generated);
    }

    return res.json({
      tpl,

      aiInput: {
        category,
        mainText,
        brand: canonicalBrand,
        condition,
        model,
        material,
        color,
        features
      },

      facts: { handling_time, ships_from, estimated_delivery },
      brand: canonicalBrand,
      ...generated
    });

  } catch (e) {
    return res.status(500).json({ error: "Server exception", details: String(e) });
  }
}



