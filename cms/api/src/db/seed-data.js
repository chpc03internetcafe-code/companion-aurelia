// Demo content: fictional profiles, locations, tiers, pages and FAQs. Everything is invented.

export const categories = [
  { name: 'Female', slug: 'female', description: 'Verified female companions for dinners, events and travel.', intro: 'Elegant, articulate company for business dinners, gala nights, gallery openings and weekend getaways. Every profile is ID-verified and updated by our team.' },
  { name: 'Male', slug: 'male', description: 'Verified male companions for social occasions and travel.', intro: 'Well-travelled, attentive gentlemen for weddings, corporate functions, dinners and city tours — verified and professionally presented.' },
  { name: 'Transgender', slug: 'transgender', description: 'Verified transgender companions for every occasion.', intro: 'Confident, charming transgender companions for nights out, events and travel. Every profile is reviewed and verified by our team.' },
];

// Cities with service areas. sections = landing page body.
export const locations = [
  {
    name: 'Makati', slug: 'makati', region: 'Metro Manila', popular: true,
    intro: 'The financial capital’s hotel district, rooftop bars and fine-dining strips make Makati the most requested city in our directory.',
    sections: [
      { type: 'text', heading: 'Companions in Makati', body: 'From Legazpi and Salcedo Villages to Rockwell, Makati is compact, walkable and full of five-star hotels — ideal for dinner dates and business functions. Most companions listed here can meet within 30 minutes.' },
      { type: 'list', heading: 'Popular meeting spots', items: ['Hotel lobby lounges along Ayala Avenue', 'Salcedo and Legazpi weekend markets', 'Rockwell restaurants and Power Plant Mall', 'Poblacion cocktail bars'] },
      { type: 'callout', heading: 'Discretion first', body: 'We never share your details with anyone except the companion you book, and only what is needed for your meeting.' },
    ],
    areas: [['Legazpi Village', 'makati-legazpi-village'], ['Salcedo Village', 'makati-salcedo-village'], ['Rockwell', 'makati-rockwell'], ['Poblacion', 'makati-poblacion']],
  },
  {
    name: 'BGC / Taguig', slug: 'bgc-taguig', region: 'Metro Manila', popular: true,
    intro: 'Bonifacio Global City’s modern towers, art installations and late-night dining make it a favourite for relaxed evenings.',
    sections: [
      { type: 'text', heading: 'Companions in BGC', body: 'High Street, Uptown and the Fort Strip offer some of the city’s best restaurants and lounges. BGC is a short ride from Makati and the airport.' },
      { type: 'list', heading: 'Good to know', items: ['Most hotels are within 10 minutes of High Street', 'Weekend evenings book out early', 'Travel from Makati is usually included'] },
    ],
    areas: [['Uptown', 'bgc-uptown'], ['High Street', 'bgc-high-street'], ['McKinley Hill', 'bgc-mckinley-hill']],
  },
  {
    name: 'Pasay & Bay Area', slug: 'pasay-bay-area', region: 'Metro Manila', popular: true,
    intro: 'Integrated resorts, bayfront dining and quick airport access — perfect for travellers with an evening in Manila.',
    sections: [{ type: 'text', heading: 'Companions in the Bay Area', body: 'Entertainment City and the Mall of Asia complex host world-class resorts, shows and restaurants. Ideal for visitors staying near the airport.' }],
    areas: [['Entertainment City', 'pasay-entertainment-city'], ['Mall of Asia complex', 'pasay-moa-complex']],
  },
  {
    name: 'Ortigas & Pasig', slug: 'ortigas-pasig', region: 'Metro Manila', popular: false,
    intro: 'A busy business district with Capitol Commons dining and quieter hotel options.',
    sections: [{ type: 'text', heading: 'Companions in Ortigas', body: 'Capitol Commons, Kapitolyo and the Ortigas Center hotels are popular with business travellers.' }],
    areas: [['Capitol Commons', 'pasig-capitol-commons'], ['Kapitolyo', 'pasig-kapitolyo']],
  },
  {
    name: 'Quezon City', slug: 'quezon-city', region: 'Metro Manila', popular: false,
    intro: 'Eastwood, Tomas Morato and Maginhawa offer lively nightlife and food streets.',
    sections: [{ type: 'text', heading: 'Companions in Quezon City', body: 'Quezon City is large — please allow extra travel time and check the meeting area with the concierge.' }],
    areas: [['Eastwood', 'qc-eastwood'], ['Tomas Morato', 'qc-tomas-morato']],
  },
  {
    name: 'Cebu City', slug: 'cebu-city', region: 'Visayas', popular: true,
    intro: 'Island hospitality with a cosmopolitan edge: IT Park, Lahug and nearby Mactan resorts.',
    sections: [
      { type: 'text', heading: 'Companions in Cebu', body: 'Our Cebu companions are based around IT Park and Lahug and can meet in Mactan by arrangement. A travel fee applies to Cebu bookings and is shown before you confirm.' },
      { type: 'list', heading: 'Popular for', items: ['Resort weekends in Mactan', 'Business dinners in IT Park', 'Island-hopping day trips'] },
    ],
    areas: [['IT Park', 'cebu-it-park'], ['Lahug', 'cebu-lahug'], ['Mactan', 'cebu-mactan']],
  },
];

export const tiers = [
  { name: 'Silver', slug: 'silver', rank: 1, price: 2500, durationDays: 30, color: '#b9bcc4', description: 'Your first step into the members’ area.',
    perks: ['Members-only collections', 'Exclusive guides and news', 'Saved favourites on every device', 'Priority replies from the concierge'] },
  { name: 'Gold', slug: 'gold', rank: 2, price: 6000, durationDays: 90, color: '#d4af6a', description: 'Our most popular membership.',
    perks: ['Everything in Silver', 'Gold-only profiles and private galleries', 'Gold Selection collection', 'First access to new companions'] },
  { name: 'Black', slug: 'black', rank: 3, price: 18000, durationDays: 365, color: '#3a3a40', description: 'A year of our highest level of access.',
    perks: ['Everything in Gold', 'Black-only profiles', 'Dedicated concierge contact', 'Travel arrangements on request'] },
];

const BIO = {
  warm: 'Warm, curious and easy to talk to, I love long dinners where the conversation drifts from travel to music to the best street food in town. Friends describe me as the person who makes everyone at the table feel welcome.',
  polished: 'Polished and well-read, I’m at home at a gala, a business dinner or a quiet wine bar. I enjoy art, design and good coffee, and I’m always happy to be your guide to the city’s best restaurants.',
  adventurous: 'An adventurous spirit who’s just as happy hiking at sunrise as dressing up for a night out. I speak several languages and love showing visitors a side of the city they wouldn’t find on their own.',
  calm: 'Calm, attentive and genuinely interested in people. I’m a great listener and an even better travel companion — punctual, organised and always ready for a spontaneous detour.',
};
const ATTR = (h, hair, eyes, style, interests) => [
  { label: 'Height', value: h }, { label: 'Hair', value: hair }, { label: 'Eyes', value: eyes }, { label: 'Style', value: style }, { label: 'Interests', value: interests },
];
const RATES_A = [['Coffee date', 60, 4500], ['Dinner date', 180, 11000], ['Evening event', 300, 16500], ['Full day / travel', 480, 24000]];
const RATES_B = [['Meet & greet', 60, 3500], ['Dinner date', 120, 7000], ['Evening out', 240, 12000]];
const RATES_C = [['Dinner date', 180, 14000], ['Gala / event', 300, 21000], ['Weekend travel day', 600, 36000]];
// [weekday list, start, end]
const EVENINGS = [[[1, 2, 3, 4, 5], '15:00', '24:00'], [[6], '12:00', '24:00']];
const WEEKENDS = [[[4, 5, 6], '13:00', '24:00'], [[0], '12:00', '20:00']];
const DAYTIME = [[[1, 2, 3, 4, 5, 6], '10:00', '20:00']];
const MOST = [[[0, 1, 2, 3, 4, 5, 6], '12:00', '23:00']];

// palette = placeholder portrait colours [top, bottom]
export const profiles = [
  { name: 'Sofia', cat: 'female', loc: 'makati-salcedo-village', areas: ['makati', 'bgc-taguig'], age: 26, tagline: 'Elegant dinner companion with a love for jazz and fine wine', bio: BIO.polished, languages: 'English, Filipino, Spanish', nationality: 'Filipino-Spanish', height: 168, attributes: ATTR('168 cm', 'Dark brown, long', 'Brown', 'Classic & elegant', 'Jazz, wine, contemporary art'), rates: RATES_A, schedule: EVENINGS, featured: true, verified: true, palette: ['#3b2a35', '#a77b6c'] },
  { name: 'Isabella', cat: 'female', loc: 'bgc-uptown', areas: ['bgc-taguig', 'makati', 'pasay-bay-area'], age: 24, tagline: 'Bright, bubbly and always up for an adventure', bio: BIO.adventurous, languages: 'English, Filipino, Korean', nationality: 'Filipino', height: 163, attributes: ATTR('163 cm', 'Black, shoulder length', 'Dark brown', 'Chic casual', 'Travel, K-dramas, hiking'), rates: RATES_A, schedule: MOST, featured: true, verified: true, palette: ['#2a3343', '#8ea4c6'] },
  { name: 'Camille', cat: 'female', loc: 'makati-rockwell', areas: ['makati'], age: 29, tagline: 'Sophisticated company for business dinners and galas', bio: BIO.polished, languages: 'English, French, Filipino', nationality: 'Filipino-French', height: 170, attributes: ATTR('170 cm', 'Chestnut, wavy', 'Hazel', 'Glamorous', 'Fashion, opera, tennis'), rates: RATES_C, schedule: WEEKENDS, featured: true, verified: true, palette: ['#2d2620', '#c9a46b'] },
  { name: 'Mika', cat: 'female', loc: 'cebu-it-park', areas: ['cebu-city', 'cebu-mactan'], age: 23, tagline: 'Island girl with a big laugh — your Cebu guide', bio: BIO.warm, languages: 'English, Cebuano, Filipino', nationality: 'Filipino', height: 158, attributes: ATTR('158 cm', 'Black, long', 'Brown', 'Sporty chic', 'Diving, food trips, karaoke'), rates: RATES_B, schedule: DAYTIME, featured: false, verified: true, palette: ['#1f3a3a', '#76b3a6'] },
  { name: 'Bianca', cat: 'female', loc: 'pasay-entertainment-city', areas: ['pasay-bay-area', 'makati'], age: 27, tagline: 'Glamorous evenings at the bay', bio: BIO.calm, languages: 'English, Filipino, Mandarin', nationality: 'Filipino-Chinese', height: 166, attributes: ATTR('166 cm', 'Black, sleek', 'Dark brown', 'Evening glam', 'Theatre, mahjong, cocktails'), rates: RATES_A, schedule: EVENINGS, featured: false, verified: false, palette: ['#33223a', '#b58bb3'] },
  { name: 'Yuna', cat: 'female', loc: 'makati-legazpi-village', areas: ['makati', 'bgc-taguig'], age: 25, tagline: 'Gold members only — refined and discreet', bio: BIO.polished, languages: 'English, Japanese, Filipino', nationality: 'Filipino-Japanese', height: 161, attributes: ATTR('161 cm', 'Dark brown, bob', 'Brown', 'Minimal & refined', 'Tea ceremony, design, film'), rates: RATES_C, schedule: WEEKENDS, featured: true, verified: true, vipTier: 'gold', palette: ['#26252b', '#9a8f86'] },
  { name: 'Andrea', cat: 'female', loc: 'ortigas-pasig', areas: ['ortigas-pasig'], age: 22, tagline: 'New profile — photos coming soon', bio: BIO.warm, languages: 'English, Filipino', nationality: 'Filipino', height: 160, attributes: ATTR('160 cm', 'Brown, long', 'Brown', 'Casual', 'Books, coffee, yoga'), rates: RATES_B, schedule: DAYTIME, status: 'Draft', ageVerified: false, palette: ['#2b2f26', '#a3ad83'] },
  { name: 'Marco', cat: 'male', loc: 'bgc-high-street', areas: ['bgc-taguig', 'makati'], age: 30, tagline: 'Charming plus-one for weddings and corporate events', bio: BIO.calm, languages: 'English, Filipino, Italian', nationality: 'Filipino-Italian', height: 183, attributes: ATTR('183 cm', 'Black, short', 'Brown', 'Tailored', 'Cooking, football, wine'), rates: RATES_A, schedule: EVENINGS, featured: true, verified: true, palette: ['#1f2630', '#6d8299'] },
  { name: 'Gabriel', cat: 'male', loc: 'makati-poblacion', areas: ['makati', 'quezon-city'], age: 27, tagline: 'Laid-back conversationalist and live-music lover', bio: BIO.warm, languages: 'English, Filipino', nationality: 'Filipino', height: 178, attributes: ATTR('178 cm', 'Dark brown, wavy', 'Dark brown', 'Smart casual', 'Guitar, gigs, basketball'), rates: RATES_B, schedule: MOST, featured: false, verified: true, palette: ['#2a2622', '#9b8770'] },
  { name: 'Rafael', cat: 'male', loc: 'cebu-lahug', areas: ['cebu-city', 'cebu-mactan'], age: 32, tagline: 'Silver members — your Cebu travel companion', bio: BIO.adventurous, languages: 'English, Cebuano, Spanish', nationality: 'Filipino', height: 180, attributes: ATTR('180 cm', 'Black, short', 'Brown', 'Resort smart', 'Sailing, diving, photography'), rates: RATES_A, schedule: DAYTIME, featured: false, verified: true, vipTier: 'silver', palette: ['#1d3036', '#6aa0ad'] },
  { name: 'Alexa', cat: 'transgender', loc: 'makati-poblacion', areas: ['makati', 'bgc-taguig'], age: 26, tagline: 'Confident, witty and unforgettable', bio: BIO.adventurous, languages: 'English, Filipino', nationality: 'Filipino', height: 172, attributes: ATTR('172 cm', 'Blonde, long', 'Brown', 'Statement fashion', 'Drag brunch, fashion, travel'), rates: RATES_A, schedule: EVENINGS, featured: true, verified: true, palette: ['#3a2430', '#d08aa0'] },
  { name: 'Danica', cat: 'transgender', loc: 'qc-tomas-morato', areas: ['quezon-city', 'ortigas-pasig'], age: 28, tagline: 'Sweet, attentive and a brilliant listener', bio: BIO.calm, languages: 'English, Filipino', nationality: 'Filipino', height: 169, attributes: ATTR('169 cm', 'Black, long', 'Dark brown', 'Feminine & soft', 'Baking, films, dancing'), rates: RATES_B, schedule: MOST, featured: false, verified: true, palette: ['#2e2433', '#a88cc0'] },
  { name: 'Kim', cat: 'transgender', loc: 'pasay-moa-complex', areas: ['pasay-bay-area'], age: 24, tagline: 'Fun nights out by the bay', bio: BIO.warm, languages: 'English, Filipino, Thai', nationality: 'Filipino-Thai', height: 165, attributes: ATTR('165 cm', 'Brown, long', 'Brown', 'Trendy', 'Concerts, gaming, food'), rates: RATES_B, schedule: WEEKENDS, featured: false, verified: false, awayDays: 5, palette: ['#262b36', '#8b99c9'] },
  { name: 'Lara', cat: 'female', loc: 'makati-salcedo-village', areas: ['makati'], age: 27, tagline: 'No longer available', bio: BIO.polished, languages: 'English, Filipino', nationality: 'Filipino', height: 164, attributes: ATTR('164 cm', 'Brown', 'Brown', 'Classic', 'Travel'), rates: RATES_A, schedule: EVENINGS, status: 'Retired', verified: true, palette: ['#2b2b2b', '#888888'] },
];

export const fees = [
  { name: 'Booking fee', description: 'Covers verification, scheduling and concierge support.', type: 'fixed', amount: 500 },
  { name: 'Cebu travel fee', description: 'Applies to meetings in Cebu City and Mactan.', type: 'fixed', amount: 1500, loc: 'cebu-city' },
];

export const pages = [
  {
    slug: 'about', title: 'About us', kicker: 'Who we are', intro: 'A small, discreet concierge team running a verified directory of adult companions for social occasions, dining and travel.',
    sections: [
      { type: 'text', heading: 'What we do', body: 'We list independent, adult companions who have been met and ID-verified by our team. We publish clear rates and live availability, and we handle booking requests so that both clients and companions know exactly what has been agreed.' },
      { type: 'stats', items: [{ value: '100%', label: 'profiles ID-verified (18+)' }, { value: '< 1 hr', label: 'typical confirmation time' }, { value: '6', label: 'cities covered' }] },
      { type: 'text', heading: 'Our standards', body: 'Every profile is reviewed before it goes live and updated regularly. Profiles that are no longer active are removed promptly. We do not tolerate any form of coercion or exploitation.' },
    ],
  },
  {
    slug: 'verification-and-safety', title: 'Verification & safety', kicker: 'Trust', intro: 'How we verify profiles and keep every meeting safe and respectful.',
    sections: [
      { type: 'list', heading: 'Every published profile has', items: ['A government ID check confirming the companion is 18 or over', 'Photos checked against the person we met', 'A “last updated” date so you can see the profile is current', 'A verified badge once our in-person review is complete'] },
      { type: 'callout', heading: 'Adults only', body: 'This website is strictly for adults. We never list anyone under 18 and we report any concern about exploitation to the authorities.' },
      { type: 'text', heading: 'Report a concern', body: 'If anything on a profile looks wrong, or you have a safety concern, contact us through the Contact page and choose “Profile correction or removal”. We review every report.' },
    ],
  },
  {
    slug: 'booking-policy', title: 'Booking policy', kicker: 'Policies', intro: 'Clear rules so everyone knows what to expect.',
    sections: [
      { type: 'list', heading: 'Booking requests', items: ['Choose a companion, a published session length, a date and a time.', 'Fees are shown before you confirm.', 'You get a reference number straight away and status updates by email.', 'A request is only final once the concierge confirms it.'] },
      { type: 'table', heading: 'Changes and cancellations', columns: ['When', 'What you can do'], rows: [['More than 24 hours before', 'Cancel or reschedule online (up to 2 reschedules)'], ['Within 24 hours', 'Contact the concierge'], ['No-show', 'Future requests may be declined']] },
    ],
  },
  {
    slug: 'terms', title: 'Terms of use', kicker: 'Policies', intro: 'The rules for using this website.',
    sections: [
      { type: 'text', heading: 'Eligibility', body: 'You must be at least 18 years old, and of legal age where you live, to use this website.' },
      { type: 'text', heading: 'Nature of the service', body: 'Companions listed here offer their time and company for social occasions. Rates are for time and companionship only. Anything else is a private matter between consenting adults and must comply with local law.' },
      { type: 'text', heading: 'Conduct', body: 'Treat companions and staff with respect. We may decline requests or close accounts in case of abusive behaviour, repeated no-shows or misuse of the site.' },
    ],
  },
  {
    slug: 'privacy', title: 'Privacy policy', kicker: 'Policies', intro: 'What we collect, why, and how long we keep it.',
    sections: [
      { type: 'list', heading: 'What we collect', items: ['Contact details you give us in a booking request or account', 'Booking history and favourites in your member account', 'Basic security logs (sign-ins, IP addresses) to protect accounts'] },
      { type: 'text', heading: 'How we use it', body: 'Only to handle your requests, run your membership and keep the service secure. We never sell your data and we share booking details only with the companion you book.' },
      { type: 'text', heading: 'Your choices', body: 'You can update your details, sign out other devices and ask us to delete your account at any time.' },
    ],
  },
];

export const posts = [
  { slug: 'first-booking-what-to-expect', kind: 'Guide', title: 'Your first booking: what to expect', excerpt: 'From choosing a profile to the moment you meet — a step-by-step guide for first-time clients.', loc: null, pinned: true,
    sections: [
      { type: 'text', heading: 'Choose with care', body: 'Read the full profile, check the published rates and availability, and look for the verified badge. Favourites help you compare.' },
      { type: 'list', heading: 'Sending your request', items: ['Pick a session length and an open time', 'Review the fees before you confirm', 'Note your reference number', 'Watch your inbox for the confirmation'] },
      { type: 'callout', heading: 'Good manners go a long way', body: 'Be on time, be respectful, and let the concierge know early if your plans change.' },
    ] },
  { slug: 'makati-evening-guide', kind: 'Guide', title: 'An evening in Makati: where to dine and unwind', excerpt: 'Our favourite restaurants, rooftop bars and quiet lounges for a memorable night in Makati.', loc: 'makati',
    sections: [
      { type: 'text', heading: 'Start with dinner', body: 'Salcedo and Legazpi Villages are full of chef-led restaurants. Book ahead on weekends.' },
      { type: 'list', heading: 'Rooftops and lounges', items: ['Hotel bars along Ayala Avenue for quiet conversation', 'Poblacion for cocktails with a view', 'Rockwell for a relaxed late dessert'] },
    ] },
  { slug: 'new-verification-standard', kind: 'Announcement', title: 'Our new verification standard', excerpt: 'Every profile now shows a “last updated” date and an in-person verified badge.', loc: null,
    sections: [{ type: 'text', heading: 'What changed', body: 'We now re-check every published profile at least every 60 days and show the date of the last update on each profile.' }] },
  { slug: 'gold-selection-preview', kind: 'News', title: 'Members preview: this month’s Gold Selection', excerpt: 'Meet the newest companions in our Gold-only collection.', loc: null, audience: 'Members', tier: 'gold',
    sections: [{ type: 'text', heading: 'New this month', body: 'Three new companions joined the Gold Selection this month, with private galleries available to Gold and Black members.' }] },
  { slug: 'discretion-etiquette', kind: 'Guide', title: 'Discretion and etiquette for dinner dates', excerpt: 'Simple habits that make every meeting relaxed and respectful.', loc: null, audience: 'Members',
    sections: [{ type: 'list', heading: 'Members’ checklist', items: ['Confirm the venue the day before', 'Keep conversation light at first', 'Settle fees as agreed with the concierge', 'Share feedback through your account'] }] },
];

export const faqs = [
  ['Booking', 'How do I book a companion?', 'Open a profile, choose a published session length and an available time, review the fees and send your request. You’ll get a reference number straight away and an email when the concierge confirms.', true],
  ['Booking', 'Can I change or cancel my booking?', 'Yes. Use “Check my booking” with your reference and email. You can cancel or reschedule online up to 24 hours before the start time.', true],
  ['Booking', 'Do I pay online?', 'Not at the moment. Rates and fees are shown before you confirm and are settled as agreed with the concierge.', true],
  ['Booking', 'What if I only have a question?', 'Use “Send an inquiry” on any profile. The concierge will reply using your preferred contact method.', false],
  ['Verification & safety', 'Are the profiles real and verified?', 'Every published profile has passed a government ID check confirming the companion is 18 or over. Profiles with the verified badge have also been reviewed in person.', true],
  ['Verification & safety', 'How current is the information?', 'Each profile shows when it was last updated. Availability is kept up to date by our team.', false],
  ['Membership', 'What do VIP members get?', 'Members-only collections, private galleries, exclusive guides and priority replies. Higher tiers unlock more profiles.', true],
  ['Membership', 'How do I join or renew?', 'Create a free account, choose a tier in your account, pay using the instructions shown and enter the payment reference. We activate it after checking the payment.', false],
  ['Privacy', 'Will my details be shared?', 'Only the details needed for a confirmed meeting are shared with the companion you book. We never sell or publish client information.', false],
  ['Privacy', 'Can I delete my account?', 'Yes — contact us and we’ll delete your account and personal data, except records we must keep by law.', false],
];

export const members = [
  ['Demo', 'Member', 'demo@aurelia.example', 'gold', 60],
  ['Paolo', 'Reyes', 'paolo.reyes@example.com', 'silver', 12],
  ['James', 'Tan', 'james.tan@example.com', 'gold', 5],
  ['Michael', 'Santos', 'michael.santos@example.com', null, null],
  ['Daniel', 'Cruz', 'daniel.cruz@example.com', 'silver', -10],
  ['Kevin', 'Lim', 'kevin.lim@example.com', 'black', 300],
  ['Ryan', 'Garcia', 'ryan.garcia@example.com', null, null],
  ['Anthony', 'Mendoza', 'anthony.mendoza@example.com', 'silver', 20],
  ['Christian', 'Lopez', 'christian.lopez@example.com', null, null],
  ['Mark', 'Villanueva', 'mark.villanueva@example.com', 'gold', 2],
  ['Joshua', 'Ramos', 'joshua.ramos@example.com', null, null],
  ['Patricia', 'Navarro', 'patricia.navarro@example.com', 'silver', 25],
  ['Victor', 'Chua', 'victor.chua@example.com', null, null],
  ['Leo', 'Aquino', 'leo.aquino@example.com', 'gold', -40],
];

export const clients = [
  ['Arnold Sy', 'arnold.sy@example.com'], ['Ben Ocampo', 'ben.ocampo@example.com'], ['Carlo Diaz', 'carlo.diaz@example.com'], ['Derek Ong', 'derek.ong@example.com'],
  ['Eric Bautista', 'eric.bautista@example.com'], ['Felix Yap', 'felix.yap@example.com'], ['George Lee', 'george.lee@example.com'], ['Henry Dizon', 'henry.dizon@example.com'],
  ['Ian Pascual', 'ian.pascual@example.com'], ['Jon Salazar', 'jon.salazar@example.com'], ['Karl Torres', 'karl.torres@example.com'], ['Liam Morgan', 'liam.morgan@example.com'],
  ['Noah Fischer', 'noah.fischer@example.com'], ['Oscar Kim', 'oscar.kim@example.com'], ['Peter Walsh', 'peter.walsh@example.com'],
];

export const inquiries = [
  ['Tom Becker', 'tom.becker@example.com', 'VIP membership', 'Hi, can I pay for a Gold membership by card? I’m visiting from Germany next month.', 'New'],
  ['Sam Rivera', 'sam.rivera@example.com', 'Booking help', 'I booked last week but didn’t receive the confirmation email. Reference BK-…? Could you check?', 'New'],
  ['Nina Castro', 'nina.castro@example.com', 'Join as a companion', 'Hello! I’d like to know how to apply to be listed. What documents do you need?', 'In Progress'],
  ['Alan Wu', 'alan.wu@example.com', 'Rates & payment', 'Do your rates include travel to Mactan for a full-day booking?', 'Resolved'],
  ['Grace Uy', 'grace.uy@example.com', 'Profile correction or removal', 'The availability on one profile seems out of date — it shows Sundays but I was told otherwise.', 'New'],
];

export const staff = [
  ['Administrator', 'Ana Reyes', 'admin@aurelia.example'],
  ['Manager', 'Miguel Santos', 'manager@aurelia.example'],
  ['Booking Coordinator', 'Bea Cruz', 'bookings@aurelia.example'],
  ['Profile Editor', 'Paolo Lim', 'profiles@aurelia.example'],
  ['Membership Manager', 'Mia Tan', 'members@aurelia.example'],
  ['Content Editor', 'Carla Go', 'content@aurelia.example'],
];

export const redirects = [
  ['/makati-companions', '/locations/makati', 'Old site URL'],
  ['/ladies', '/female', 'Old site URL'],
  ['/vip-club', '/vip', 'Old site URL'],
];
