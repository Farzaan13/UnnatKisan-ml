const CATEGORIES = ['vegetable', 'fruit', 'grain', 'pulse', 'other'];

const SYSTEM = `Tum "Kisan Sahayak" ho, Unnat Kisan website ka assistant. Tum kisan ko apni fasal ki listing banane mein madad karte ho.
Jawab chhote aur saral rakho. Jawab ki bhasha aage "Bhasha" note mein bataayi jaayegi.
Listing ke liye ye jaankari chahiye:
- name: fasal ka naam English mein (jaise Tomato, Wheat)
- category: vegetable, fruit, grain, pulse ya other
- price: customer ka rate, Rs per kg
- bulkPrice: bulk buyer ka rate, Rs per kg (kisan na bataye to poochho)
- quantity: kitne kg available hai
- minBulkQty: bulk ka minimum kg (optional, default 100)
- harvestDate: kataai ki tareekh YYYY-MM-DD (optional)
- location: gaon / sheher / zila (text)
- description: 1-2 line (optional)

Rules:
- Ek baar mein sirf ek ya do sawal poochho. Jo jaankari mil chuki hai use dobara mat poochho.
- Kam se kam name, price aur quantity milte hi draft bana do. Baaki fields kisan form mein bhar lega.
- Rate ya quantity kabhi khud mat banao. Kisan ne jo bataya wahi likho.
- Customer ke minimum order: vegetable 10 kg, fruit 20 kg, grain/pulse/other 50 kg. Quantity isse kam ho to kisan ko batao.
- Sirf fasal ki listing se jude sawal ka jawab do. Baaki sawalon par vinamrata se mana karo.
- Tum listing live nahi karte. Kisan form mein photo lagakar aur location verify karke submit karta hai, phir admin verify karta hai. Ye baat draft banane par batao.

Hamesha SIRF valid JSON do, aur kuch nahi:
{"reply":"kisan ke liye message","draft":null}
Draft tab do jab name, price, quantity pata ho. Jo field pata na ho use null rakho:
{"reply":"...","draft":{"name":"","category":"","price":0,"bulkPrice":0,"quantity":0,"minBulkQty":0,"harvestDate":"","location":"","description":""}}`;

// speech aur reply ki bhashayein (key = browser ka language code)
const LANGS = {
  'hi-IN': 'Hindi (Devanagari script)',
  'en-IN': 'English',
  'mr-IN': 'Marathi (Devanagari script)',
  'bn-IN': 'Bengali (Bengali script)',
  'gu-IN': 'Gujarati (Gujarati script)',
  'pa-guru-IN': 'Punjabi (Gurmukhi script)',
  'ta-IN': 'Tamil (Tamil script)',
  'te-IN': 'Telugu (Telugu script)',
  'kn-IN': 'Kannada (Kannada script)',
  'ml-IN': 'Malayalam (Malayalam script)'
};

function buildSystem(voice, lang) {
  const name = LANGS[lang] || LANGS['hi-IN'];
  let s = SYSTEM + `

Bhasha: kisan ne "${name}" chuni hai. "reply" hamesha ${name} mein, uski apni lipi (script) mein likho. Agar kisan kisi aur bhasha mein likhe ya bole to usi bhasha mein jawab do.
Draft ke fields (name, category, location, description) hamesha English / Roman letters mein likho, jaise Tomato, Kanpur. Fasal ka naam local bhasha mein ho to uska English naam likho.`;

  if (voice) {
    s += `
"reply" ko bolkar sunaya jaayega: chhote saral vakya likho, koi emoji ya symbol mat lagao, sankhya ankon mein likho.`;
  }
  return s;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

// model ka draft bharosemand nahi maan sakte, isliye har field saaf karo
function cleanDraft(d) {
    if (!d || typeof d !== 'object') return null;
    const draft = {
        name: str(d.name, 60),
        category: CATEGORIES.includes(d.category) ? d.category : 'other',
        price: num(d.price, 0.01, 100000),
        bulkPrice: num(d.bulkPrice, 0.01, 100000),
        quantity: num(d.quantity, 1, 10000000),
        minBulkQty: num(d.minBulkQty, 1, 10000000),
        harvestDate: /^\d{4}-\d{2}-\d{2}$/.test(d.harvestDate || '') ? d.harvestDate : undefined,
        location: str(d.location, 100),
        description: str(d.description, 500)
    };
    if (draft.quantity) draft.quantity = Math.round(draft.quantity);
    if (!draft.name || !draft.price || !draft.quantity) return null;
    return draft;
}

// client se aayi history ko saaf karo: sirf user/assistant, chhoti, user se shuru
function cleanMessages(list) {
    if (!Array.isArray(list)) return [];
    const msgs = list
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }))
        .slice(-12);
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    return msgs;
}

exports.chatCrop = async (messages, voice, lang) => {
    const msgs = cleanMessages(messages);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
        return { reply: 'Apni fasal ke baare mein likho, jaise "200 kg tamatar, 25 rupaye kilo".', draft: null };
    }
    const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const call = (lowThinking) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
               systemInstruction: { parts: [{ text: buildSystem(voice, lang) }] },
        contents: msgs.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.4,
          responseMimeType: 'application/json',
          ...(lowThinking ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {})
        }
      })
    });

  const t0 = Date.now();
  let res = await call(true);
  if (res.status === 400) res = await call(false);   // model ye setting na maane to bina uske
  console.log(`chatbot: ${model} ne ${Date.now() - t0} ms liye`);

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Gemini API ${res.status} model="${model}" ${body}`);
  }

    const data = await res.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join('');

    // JSON nikalo (kabhi model ``` laga deta hai)
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    try {
        const out = JSON.parse(text.slice(a, b + 1));
        return { reply: str(out.reply, 800) || 'Aage batao.', draft: cleanDraft(out.draft) };
    } catch (e) {
        return { reply: text.slice(0, 800) || 'Dobara try karo.', draft: null };
    }
};