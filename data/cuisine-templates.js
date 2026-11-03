/** Typical high-protein dishes by cuisine — used when live menus aren't available. */
window.PROTIVA_TEMPLATES = {
  default: [
    { name: "Grilled Chicken Plate", price: 11, protein: [36, 44], kcal: [420, 520], tags: ["poultry", "high-protein"], ask: "I'd like the grilled chicken plate, please." },
    { name: "Egg / Omelette Plate", price: 7, protein: [22, 28], kcal: [280, 360], tags: ["eggs", "budget"], ask: "I'd like an omelette / egg plate, please." },
    { name: "Lentil or Bean Bowl", price: 8, protein: [18, 24], kcal: [340, 420], tags: ["veg", "budget"], ask: "I'd like a lentil or bean bowl, please." },
  ],
  grill: [
    { name: "Chicken Breast / Shish", price: 10, protein: [38, 48], kcal: [430, 540], tags: ["poultry", "high-protein", "value"], ask: "I'd like chicken breast / chicken shish, please." },
    { name: "Lean Steak / Beef Skewer", price: 16, protein: [36, 46], kcal: [480, 600], tags: ["beef", "high-protein"], ask: "I'd like a lean steak / beef skewer, please." },
    { name: "Mixed Grill (half)", price: 12, protein: [32, 40], kcal: [560, 700], tags: ["mixed"], ask: "I'd like a half mixed grill, please." },
  ],
  turkish: [
    { name: "Chicken Shish", price: 9.5, protein: [36, 46], kcal: [500, 620], tags: ["poultry", "high-protein", "value"], ask: "I'd like chicken shish, please." },
    { name: "Adana / Kebab Plate", price: 11, protein: [32, 42], kcal: [600, 740], tags: ["beef"], ask: "I'd like an Adana / kebab plate, please." },
    { name: "Lentil Soup + Egg", price: 5.5, protein: [16, 22], kcal: [260, 340], tags: ["veg", "budget"], ask: "I'd like lentil soup with egg, please." },
  ],
  seafood: [
    { name: "Grilled Fish Fillet", price: 15, protein: [32, 42], kcal: [360, 460], tags: ["seafood", "high-protein"], ask: "I'd like the grilled fish fillet, please." },
    { name: "Grilled Squid / Calamari", price: 13, protein: [28, 36], kcal: [340, 440], tags: ["seafood"], ask: "I'd like grilled calamari, please." },
    { name: "Garlic Shrimp", price: 16, protein: [26, 34], kcal: [320, 420], tags: ["seafood"], ask: "I'd like garlic shrimp, please." },
  ],
  japanese: [
    { name: "Salmon Sashimi Set", price: 14, protein: [28, 36], kcal: [280, 360], tags: ["seafood", "high-protein"], ask: "I'd like a salmon sashimi set, please." },
    { name: "Chicken Teriyaki Bowl", price: 11, protein: [30, 38], kcal: [480, 600], tags: ["poultry"], ask: "I'd like a chicken teriyaki bowl, please." },
    { name: "Tofu Miso Set", price: 9, protein: [18, 24], kcal: [320, 400], tags: ["veg"], ask: "I'd like a tofu miso set, please." },
  ],
  chinese: [
    { name: "Steamed Fish / Chicken", price: 12, protein: [30, 40], kcal: [360, 480], tags: ["poultry", "seafood", "high-protein"], ask: "I'd like steamed fish or chicken, please." },
    { name: "Egg Foo Young / Eggs", price: 8, protein: [20, 26], kcal: [380, 480], tags: ["eggs"], ask: "I'd like egg foo young, please." },
    { name: "Mapo Tofu (less oil)", price: 9, protein: [18, 24], kcal: [400, 520], tags: ["veg"], ask: "I'd like mapo tofu, less oil, please." },
  ],
  italian: [
    { name: "Grilled Chicken Salad", price: 12, protein: [30, 38], kcal: [400, 520], tags: ["poultry"], ask: "I'd like a grilled chicken salad, please." },
    { name: "Tuna Pasta", price: 11, protein: [26, 34], kcal: [540, 680], tags: ["seafood"], ask: "I'd like tuna pasta, please." },
    { name: "Caprese + Prosciutto", price: 10, protein: [22, 28], kcal: [380, 480], tags: ["pork"], ask: "I'd like Caprese with prosciutto, please." },
  ],
  pizza: [
    { name: "Prosciutto Pizza (half)", price: 8, protein: [18, 24], kcal: [480, 600], tags: ["pork", "budget"], ask: "I'd like half a prosciutto pizza, please." },
    { name: "Chicken Pizza (half)", price: 8.5, protein: [22, 28], kcal: [500, 620], tags: ["poultry"], ask: "I'd like half a chicken pizza, please." },
    { name: "Side Salad + Eggs", price: 7, protein: [16, 22], kcal: [280, 360], tags: ["eggs", "veg", "budget"], ask: "I'd like a side salad with eggs, please." },
  ],
  cafe: [
    { name: "Egg White / Veg Omelette", price: 7, protein: [24, 32], kcal: [260, 340], tags: ["eggs", "high-protein", "budget"], ask: "I'd like an egg-white or veg omelette, please." },
    { name: "Greek Yogurt Bowl", price: 6, protein: [18, 24], kcal: [280, 360], tags: ["veg", "budget"], ask: "I'd like a Greek yogurt bowl, please." },
    { name: "Tuna / Chicken Sandwich", price: 9, protein: [26, 34], kcal: [420, 540], tags: ["poultry", "seafood"], ask: "I'd like a tuna or chicken sandwich, please." },
  ],
  burger: [
    { name: "Chicken Burger (no bun / salad)", price: 10, protein: [32, 40], kcal: [420, 560], tags: ["poultry"], ask: "I'd like a chicken burger as a salad, please." },
    { name: "Lean Beef Burger + Salad", price: 12, protein: [30, 38], kcal: [520, 680], tags: ["beef"], ask: "I'd like a lean beef burger with salad, please." },
    { name: "Veggie Burger + Egg", price: 9, protein: [20, 26], kcal: [420, 540], tags: ["veg", "eggs"], ask: "I'd like a veggie burger with egg, please." },
  ],
  indian: [
    { name: "Tandoori Chicken", price: 11, protein: [34, 44], kcal: [420, 540], tags: ["poultry", "high-protein"], ask: "I'd like tandoori chicken, please." },
    { name: "Dal + Egg / Paneer", price: 9, protein: [20, 28], kcal: [400, 520], tags: ["veg"], ask: "I'd like dal with egg or paneer, please." },
    { name: "Fish Curry (less sauce)", price: 12, protein: [28, 36], kcal: [400, 520], tags: ["seafood"], ask: "I'd like fish curry, less sauce, please." },
  ],
  healthy: [
    { name: "Chicken Quinoa / Rice Bowl", price: 11, protein: [34, 42], kcal: [460, 560], tags: ["poultry", "high-protein", "value"], ask: "I'd like a chicken protein bowl, please." },
    { name: "Salmon Greens", price: 14, protein: [30, 38], kcal: [420, 520], tags: ["seafood"], ask: "I'd like salmon with greens, please." },
    { name: "Tofu Power Bowl", price: 9, protein: [20, 26], kcal: [380, 480], tags: ["veg"], ask: "I'd like a tofu power bowl, please." },
  ],
  mediterranean: [
    { name: "Grilled Octopus / Fish", price: 17, protein: [30, 40], kcal: [360, 460], tags: ["seafood"], ask: "I'd like grilled octopus or fish, please." },
    { name: "Chicken Souvlaki / Plate", price: 10, protein: [34, 42], kcal: [450, 560], tags: ["poultry", "value"], ask: "I'd like chicken souvlaki, please." },
    { name: "Greek Salad + Feta + Egg", price: 8, protein: [18, 24], kcal: [320, 420], tags: ["veg", "eggs", "budget"], ask: "I'd like Greek salad with feta and egg, please." },
  ],
};

window.PROTIVA_CUISINE_ALIASES = [
  { re: /kebab|doner|döner|shawarma|turkish|anatolia|adana/i, key: "turkish" },
  { re: /sushi|ramen|japanese|izakaya/i, key: "japanese" },
  { re: /chinese|sichuan|dim\s*sum|wok/i, key: "chinese" },
  { re: /pizza|pizzeria/i, key: "pizza" },
  { re: /burger|mcdonald|kfc|subway/i, key: "burger" },
  { re: /indian|tandoor|curry|biryani/i, key: "indian" },
  { re: /seafood|fish|marina|ocean|pesc/i, key: "seafood" },
  { re: /grill|steak|bbq|barbecue|mesnica/i, key: "grill" },
  { re: /bowl|salad|healthy|fit|poke|verde/i, key: "healthy" },
  { re: /cafe|coffee|bakery|bistro|breakfast/i, key: "cafe" },
  { re: /italian|pasta|trattoria|osteria/i, key: "italian" },
  { re: /mediterranean|greek|taverna|konoba|mezze/i, key: "mediterranean" },
  { re: /fast_food|fast food/i, key: "burger" },
];
