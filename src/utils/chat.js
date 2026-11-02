// Opens the live chat window from anywhere (header, mobile bar, homepage) without loading the chat code first:
// components/LiveChat.jsx listens for this event. `context` ({ profileId, name }) says which profile the visitor is
// asking about; it's also kept here in case the chat code hasn't loaded yet.
export const OPEN_CHAT_EVENT = 'aurelia:open-chat';
let pending = null;
export const openChat = (context = null) => {
  pending = context?.profileId ? { profileId: context.profileId, name: context.name } : null;
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: pending }));
};
/** The context of the last openChat() call (once). */
export const takeChatContext = () => { const c = pending; pending = null; return c; };
