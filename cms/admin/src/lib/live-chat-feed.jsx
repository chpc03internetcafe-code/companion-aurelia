// Live chat feed for the whole CMS: one long-poll request to GET /api/live-chat/wait, kept open on every page
// (also while the tab is in the background). It keeps the sidebar badge current, fires a `cms:live-chat` window
// event so the Live chat page can refresh, and alerts staff to visitor replies in running chats: a chime, a toast,
// and a desktop notification when the tab is in the background. New chats (and chats that had gone quiet) already
// get a staff notification from the server, so those are left to lib/notifications.jsx.
// Alerts are for chats assigned to you or to nobody, and not for the chat you're looking at. No message text is shown.
// It also says which chats' visitors are typing (CHAT_TYPING_EVENT with { ids }) whenever that changes, and fires
// CHAT_FEED_EVENT when a message is deleted for everyone (so open threads show it).
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { useUi } from './ui';
import { chime, claim, useNotifications } from './notifications';

export const CHAT_FEED_EVENT = 'cms:live-chat';
export const CHAT_TYPING_EVENT = 'cms:live-chat-typing';
let typingNow = []; // the last known list, for pages that open after it was sent
export const typingChatIds = () => typingNow;
const RETRY_MS = 5000;

export function useLiveChatFeed({ pathname, onStats }) {
  const { user, can } = useAuth();
  const { toast } = useUi();
  const { sound } = useNotifications();
  const navigate = useNavigate();
  const enabled = !!user && can('inquiries');
  // read inside the loop without restarting it
  const live = useRef({});
  live.current = { pathname, onStats, toast, sound, navigate, userId: user?.id };

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let after = 0;
    let typing = '';
    let deletions = null; // messages deleted for everyone, in all chats
    let wake = () => {};
    const pause = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });

    const alert = (alerts) => {
      const { pathname: path, toast: say, sound: ring, navigate: go, userId } = live.current;
      const looking = document.visibilityState === 'visible';
      const seen = new Set();
      const due = alerts.filter((a) => {
        if (a.notified || seen.has(a.chatId)) return false; // the server notification covers it; one alert per chat
        seen.add(a.chatId);
        if (a.assignedTo && a.assignedTo !== userId) return false;
        return !(looking && path === `/live-chat/${a.chatId}`);
      });
      if (!due.length || !claim(`chat-${due[0].id}`)) return; // several CMS tabs: only one alerts
      if (ring) chime();
      const title = due.length === 1 ? `${due[0].visitorName} replied in live chat` : `New replies in ${due.length} live chats`;
      if (looking) say(title);
      else if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body: 'Open the CMS to read and reply.', tag: `cms-chat-${due[0].chatId}` });
        n.onclick = () => { window.focus(); go(`/live-chat/${due[0].chatId}`); n.close(); };
      }
    };

    (async () => {
      while (!stopped) {
        try {
          const r = await api.get('/live-chat/wait', { after, typing: typing || '-', del: deletions ?? '' }); // '-': nobody (empty values aren't sent)
          if (stopped) break;
          const nowTyping = (r.typing || []).join(',');
          if (nowTyping !== typing) {
            typing = nowTyping;
            typingNow = r.typing || [];
            window.dispatchEvent(new CustomEvent(CHAT_TYPING_EVENT, { detail: { ids: typingNow } }));
          }
          live.current.onStats?.(r.stats);
          const deleted = deletions !== null && r.deletions !== deletions;
          deletions = r.deletions ?? deletions;
          if ((after && r.latestId > after) || deleted) {
            window.dispatchEvent(new CustomEvent(CHAT_FEED_EVENT, { detail: { latestId: r.latestId, stats: r.stats } }));
            if (after && r.latestId > after) alert(r.alerts || []);
          }
          after = r.latestId;
        } catch {
          await pause(RETRY_MS);
        }
      }
    })();
    return () => { stopped = true; wake(); typingNow = []; };
  }, [enabled]);
}
