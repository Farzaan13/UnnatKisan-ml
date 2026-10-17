// Home page ke liye category ka naam aur emoji
const CATEGORY_META = {
  vegetable: { emoji: '🥦', name: 'Vegetables', en: 'Vegetables' },
  fruit:     { emoji: '🍎', name: 'Fruits',      en: 'Fruits' },
  grain:     { emoji: '🌾', name: 'Grains',    en: 'Grains' },
  pulse:     { emoji: '🫘', name: 'Pulses',   en: 'Pulses' },
  other:     { emoji: '🧺', name: 'Other',     en: 'Other' }
};

const CATEGORY_ORDER = ['vegetable', 'fruit', 'grain', 'pulse', 'other'];

// crop ke naam se emoji (English aur Hinglish dono naam chalte hain)
const KEYWORDS = [
  // sabziyan
  [['tomato', 'tamatar'], '🍅'],
  [['potato', 'aloo', 'aalu'], '🥔'],
  [['onion', 'pyaz', 'pyaaz'], '🧅'],
  [['carrot', 'gajar'], '🥕'],
  [['brinjal', 'baingan', 'eggplant'], '🍆'],
  [['chilli', 'chili', 'mirch', 'pepper'], '🌶️'],
  [['corn', 'makka', 'maize', 'bhutta'], '🌽'],
  [['garlic', 'lehsun'], '🧄'],
  [['cucumber', 'kheera', 'kakdi'], '🥒'],
  [['cabbage', 'gobhi', 'cauliflower', 'broccoli'], '🥦'],
  [['spinach', 'palak', 'methi', 'saag'], '🥬'],
  [['peas', 'matar'], '🌱'],
  [['pumpkin', 'kaddu'], '🎃'],
  // fal
  [['mango', 'aam'], '🥭'],
  [['banana', 'kela'], '🍌'],
  [['apple', 'seb'], '🍎'],
  [['orange', 'santra', 'narangi'], '🍊'],
  [['grape', 'angoor'], '🍇'],
  [['watermelon', 'tarbooz'], '🍉'],
  [['pineapple', 'ananas'], '🍍'],
  [['lemon', 'nimbu'], '🍋'],
  [['guava', 'amrood'], '🍐'],
  [['strawberry'], '🍓'],
  [['coconut', 'nariyal'], '🥥'],
  [['peach', 'aadu'], '🍑'],
  [['cherry'], '🍒'],
  // anaaj
  [['wheat', 'gehun', 'gehu'], '🌾'],
  [['rice', 'chawal', 'paddy', 'dhan'], '🍚'],
  [['bajra', 'jowar', 'millet', 'ragi'], '🌾'],
  // dalein
  [['dal', 'lentil', 'masoor', 'moong', 'chana', 'rajma', 'arhar', 'toor', 'urad'], '🫘'],
  // anya
  [['peanut', 'moongfali'], '🥜'],
  [['sugarcane', 'ganna'], '🎋'],
  [['honey', 'shahad'], '🍯'],
  [['mustard', 'sarson'], '🌼']
];

function cropEmoji(name, category) {
  const n = String(name || '').toLowerCase();
  for (const [words, emoji] of KEYWORDS) {
    if (words.some((w) => n.includes(w))) return emoji;
  }
  return (CATEGORY_META[category] || CATEGORY_META.other).emoji;
}

module.exports = { CATEGORY_META, CATEGORY_ORDER, cropEmoji };