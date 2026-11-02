// Sample live chat replies: [title, text]. Seeded into new databases, and added on request from
// CMS → Live chat → Reply templates. {name} = the visitor, {profile} = the profile they asked about, {agent} = you.
export const SAMPLE_TEMPLATES = [
  // opening
  ['Greeting', 'Hi {name}, thanks for reaching out! This is {agent} from the concierge desk. How can I help you today?'],
  ['Welcome back', 'Welcome back, {name}! Good to hear from you again. How can I help today?'],
  ['Busy desk', 'Thanks for your message, {name}! We’re helping other guests right now and will reply as soon as we can. If you need to step away, leave your email and we’ll let you know when we’ve answered.'],
  // while checking
  ['One moment', 'Thanks, {name}. One moment while I check that for you.'],
  ['Still checking', 'Thanks for waiting, {name}. I’m still checking this and will be right back with you.'],
  ['Ask for details', 'Happy to help! Could you tell me the date, start time and how long you’d like to book, and the area you’ll be in?'],
  // availability and booking
  ['Availability check', 'Let me check {profile}’s availability for you. Which date and time do you have in mind?'],
  ['Available', 'Good news: {profile} is available then. You can request the booking on the profile page by choosing a rate and the open time, and we’ll confirm it shortly.'],
  ['Not available', 'I’m sorry, {profile} isn’t available at that time. Would another date or time work for you, or shall I suggest similar companions who are free then?'],
  ['How to book', 'To book, open the profile you like, choose a rate and an open time, and send the request. Our team reviews every request and confirms it with you by email.'],
  ['Booking received', 'Thank you, {name}! We’ve received your booking request and will confirm it with you shortly. Keep your booking reference handy in case you need to make changes.'],
  ['Change or cancel', 'No problem. Please send me your booking reference and the change you’d like to make, and I’ll take care of it. Our booking policy on the website explains notice periods and any fees.'],
  // rates and policies
  ['Rates', 'Rates are listed on each profile page and are for time and companionship only. Any applicable fees are shown before you confirm.'],
  ['Privacy', 'Your privacy matters to us. Chat messages are stored encrypted, and your details are only used to handle your booking. They’re never shared or sold.'],
  ['Verification', 'Every companion on our site is an adult (18+), and our team checks their government ID and photos before a profile is published.'],
  ['Not something we offer', 'I’m sorry, but that’s not something we can help with. Our companions offer their time and companionship only. Is there anything else I can help you with?'],
  // follow-up and closing
  ['Ask for email', 'In case we get disconnected, could you share your email address? We’ll only use it to follow up on this conversation.'],
  ['Are you still there?', 'Are you still there, {name}? I’ll keep this chat open for a few more minutes. Feel free to reply whenever you’re ready.'],
  ['Closing', 'Is there anything else I can help you with? Thank you for chatting with us, {name}. Have a lovely day!'],
];
